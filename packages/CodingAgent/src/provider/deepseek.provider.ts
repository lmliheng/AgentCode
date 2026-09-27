import type {
    AgentProvider,
    AgentProviderConfig,
    ModelResponse,
    DeepSeekResponse,
    DeepSeekMessage,
    DeepSeekToolCall,
    DeepSeekUsage,
    DeepSeekChunk,
    DeepSeekChoice,
    StreamDelta,
    ToolDefinition,
    DeepseekToolDefinition,
    JsonSchemaObject,
} from '../types/AgentProvider.js'
import { REQUEST_REPLAN_TOOL, BATCH_TOOL } from '../types/AgentProvider.js'
import type { ChatMessage, AssistantMessage } from '../types/Message.js'
import type { ModelDecision, Action, BatchAction, PlanStep } from '../types/ReAct.js'

/**
 * @Deepseek Provider
 *
 *   - 请求侧：把 ToolDefinition[] 翻译为原生 tools 声明下发
 *   - 响应侧：把原生 tool_calls 翻译为 Action / BatchAction / Final
 * 除此之外不做决策，运行时的循环、预算、审批都不在这里。
 */

/** 未显式配置 baseUrl 时使用的默认端点 */
export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1/chat/completions'

/**
 * 控制流入口。它们不是可执行工具，只用于让模型主动触发状态迁移
 * （见 design.md D3）：Final 由「本轮没有工具调用」回落产生，模型因此失去在
 * 完成轮次里携带声明的能力，需要主动表达意图时必须另开工具入口。
 *
 * 名字定义在 types/AgentProvider.ts 的协议契约层，这里只是本地引用。
 */
const PLAN_STEP_SCHEMA = {
    type: 'object',
    properties: {
        id: { type: 'string', description: '步骤的唯一标识' },
        description: { type: 'string', description: '步骤描述' },
        status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'completed', 'failed'],
            description: '步骤状态，新步骤一律为 pending',
        },
        dependsOn: {
            type: 'array',
            items: { type: 'string' },
            description: '依赖的其他步骤 id',
        },
        completionCriteria: { type: 'string', description: '如何判断此步骤完成' },
    },
    required: ['description'],
} as const

const CONTROL_FLOW_TOOLS: ToolDefinition[] = [
    {
        name: REQUEST_REPLAN_TOOL,
        description:
            '当前计划不可行时，提交一份新的步骤列表以重新规划。仅在你确信原计划无法继续时使用；一般性的试错请直接调用工具。',
        parameters: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: '为什么需要重新规划' },
                newPlan: {
                    type: 'array',
                    description: '新的步骤列表，按执行顺序排列',
                    items: PLAN_STEP_SCHEMA,
                },
            },
            required: ['reason', 'newPlan'],
        },
    },
    {
        name: BATCH_TOOL,
        description:
            '一次提交多个相互独立的动作以并发执行。仅当这些动作之间没有依赖关系时使用；有依赖时请逐个调用。',
        parameters: {
            type: 'object',
            properties: {
                actions: {
                    type: 'array',
                    description: '要执行的动作列表',
                    items: {
                        type: 'object',
                        properties: {
                            tool: { type: 'string', description: '工具名称' },
                            params: { type: 'object', description: '该工具的参数' },
                            thought: { type: 'string', description: '为什么调用这个工具' },
                        },
                        required: ['tool', 'params'],
                    },
                },
            },
            required: ['actions'],
        },
    },
]

type ParseArgumentsResult =
    | { ok: true; value: Record<string, unknown> }
    | { ok: false; raw: string; reason: string }

export class DeepSeekProvider implements AgentProvider {
    readonly name = 'deepseek'
    public config: AgentProviderConfig

    constructor(config: AgentProviderConfig) {
        this.config = {
            baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
            temperature: 0.2,
            maxTokens: 4096,
            stream: true,
            ...config,
        };
    }

    updateConfig(config: Partial<AgentProviderConfig>): void {
        this.config = { ...this.config, ...config }
    }

    /**
     * 请求模型做一次决策。
     *
     * 流式与否在协议上不同、在结果上相同：两条路都必须产出同一个
     * `ModelResponse`（见 `consumeStream`）。
     *
     * @param messages 对话消息序列
     * @param tools 当前可执行的工具；为空时不声明任何工具，控制流入口也不声明
     * @param onDelta 增量回调，见 `AgentProvider.decide`
     */
    async decide(
        messages: ChatMessage[],
        tools: ToolDefinition[] = [],
        onDelta?: (delta: StreamDelta) => void,
    ): Promise<ModelResponse> {
        // 工具声明只在存在可执行工具时才有意义：没有工具可用时，
        // 声明「重新规划」「批量动作」入口没有语义。
        const declaredTools = tools.length > 0 ? [...tools, ...CONTROL_FLOW_TOOLS] : []

        const requestBody: Record<string, unknown> = {
            model: this.config.modelName,
            messages: messages.map(msg => this.formatMessage(msg)),
        };
        if (this.config.temperature !== undefined) {
            requestBody.temperature = this.config.temperature;
        }
        if (this.config.maxTokens !== undefined) {
            requestBody.max_tokens = this.config.maxTokens;
        }
        if (declaredTools.length > 0) {
            requestBody.tools = declaredTools.map(tool => this.toDeepseekTool(tool));
        }
        if (this.config.stream) {
            requestBody.stream = true;
        }

        // 超时控制
        const timeoutMs = this.config.timeout ?? 30000;
        const controller = new AbortController();
        let timeoutMessage = `DeepSeek 请求超时（${timeoutMs}ms）`;
        let timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        /**
         * 流式下把计时器往后推。
         *
         * 一个固定截止时间对流式不成立：长回答必然超过它，于是「请求超时」会把
         * 正常的长输出当成故障掐掉。改成静默超时 —— 只要还在收到数据就重新计时，
         * 真的不再有新数据时才中断。
         *
         * 只有 `consumeStream` 会调它，所以非流式那条路上的超时文案保持不变。
         */
        const armTimeout = (): void => {
            clearTimeout(timeoutId);
            timeoutMessage = `DeepSeek 流式响应中断（${timeoutMs}ms 内未收到新数据）`;
            timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        };
        

        try {
            const response = await fetch(this.config.baseUrl!, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.config.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal,
            });

            if (this.config.stream) {
                // 流式下响应体是 SSE，不能当 JSON 解析；而错误响应仍是普通 JSON，
                // 所以按状态码分流，而不是像非流式那样先 json() 再判断 ok。
                if (!response.ok) {
                    throw new Error(
                        `DeepSeek 调用失败：${response.status} ${await readErrorDetail(response)}`
                    );
                }
                return await this.consumeStream(response, onDelta, armTimeout);
            }

            const data: DeepSeekResponse = await response.json();

            if (!response.ok) {
                throw new Error(
                    `DeepSeek 调用失败：${response.status} ${JSON.stringify(data)}`
                );
            }

            const choice = data.choices?.[0];

            if (!choice?.message) {
                throw new Error(`DeepSeek 没有返回有效消息：${JSON.stringify(data)}`);
            }

            const responseMessage = choice.message;
            const toolCalls = responseMessage.tool_calls ?? [];
            const cache = readPromptCacheTokens(data.usage);

            return {
                decision: toolCalls.length > 0
                    ? this.translateToolCalls(toolCalls, responseMessage)
                    : this.toFinalDecision(responseMessage),
                rawContent: responseMessage.content ?? '',
                reasoningContent: responseMessage.reasoning_content ?? '',
                finishReason: choice.finish_reason!,
                modelName: data.model,
                usage: {
                    promptTokens: data.usage.prompt_tokens,
                    completionTokens: data.usage.completion_tokens,
                    totalTokens: data.usage.total_tokens,
                    ...(cache.hit !== undefined ? { cacheHitTokens: cache.hit } : {}),
                    ...(cache.miss !== undefined ? { cacheMissTokens: cache.miss } : {}),
                },
            };

        } catch (err: any) {
            // 信号判断放在错误名之前：读流中途被 abort 时，底层抛出的往往不是
            // AbortError（可能是 terminated 之类的传输层错误），只看错误名会把
            // 一次超时报告成一个莫名其妙的中断。
            if (controller.signal.aborted || err.name === 'AbortError') {
                throw new Error(timeoutMessage);
            }
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * 消费 SSE 流，把分片重新拼成一份完整响应。
     *
     * 拼出来的形状与非流式完全一致，因此边界翻译（`translateToolCalls` /
     * `toFinalDecision`）两条路共用同一份实现 —— 流式只改变「响应怎么取回来」，
     * 不改变「响应是什么」。
     */
    private async consumeStream(
        response: Response,
        onDelta: ((delta: StreamDelta) => void) | undefined,
        armTimeout: () => void,
    ): Promise<ModelResponse> {
        const body = response.body;
        if (!body) {
            throw new Error('DeepSeek 返回了流式响应但没有响应体');
        }

        const reader = body.getReader();
        // 多字节字符会被切在分块之间，必须用流式解码器续着解：对每个分块
        // 单独 toString() 会让切开的汉字变成乱码。
        const decoder = new TextDecoder('utf-8');

        let buffer = '';
        let content = '';
        let reasoning = '';
        let finishReason: DeepSeekChoice['finish_reason'] = null;
        let usage: DeepSeekUsage | undefined;
        let modelName: string | undefined;
        let done = false;

        // 工具调用按 index 归并：一次调用可能横跨任意多块
        const calls = new Map<number, {
            index: number;
            id: string;
            name: string;
            arguments: string;
        }>();

        const handleData = (payload: string): void => {
            if (payload === '[DONE]') {
                done = true;
                return;
            }

            let chunk: DeepSeekChunk;
            try {
                chunk = JSON.parse(payload) as DeepSeekChunk;
            } catch {
                // 静默跳过会悄悄吞掉正文，宁可在这里明确失败
                throw new Error(
                    `DeepSeek 流式响应含无法解析的数据块: ${payload.slice(0, 200)}`
                );
            }

            if (chunk.model) modelName = chunk.model;
            if (chunk.usage) usage = chunk.usage;

            const choice = chunk.choices?.[0];
            if (!choice) return;
            if (choice.finish_reason) finishReason = choice.finish_reason;

            const delta = choice.delta;
            if (!delta) return;

            if (typeof delta.reasoning_content === 'string' && delta.reasoning_content !== '') {
                reasoning += delta.reasoning_content;
                onDelta?.({ reasoningContent: delta.reasoning_content });
            }
            if (typeof delta.content === 'string' && delta.content !== '') {
                content += delta.content;
                onDelta?.({ content: delta.content });
            }
            for (const fragment of delta.tool_calls ?? []) {
                const entry = calls.get(fragment.index)
                    ?? { index: fragment.index, id: '', name: '', arguments: '' };
                if (fragment.id) entry.id = fragment.id;
                if (fragment.function?.name) entry.name = fragment.function.name;
                if (fragment.function?.arguments) entry.arguments += fragment.function.arguments;
                calls.set(fragment.index, entry);
            }
        };

        const handleLine = (rawLine: string): void => {
            const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
            if (line === '' || line.startsWith(':')) return;   // 空行分隔与 keep-alive 注释
            if (!line.startsWith('data:')) return;
            handleData(line.slice('data:'.length).trim());
        };

        while (!done) {
            const { value, done: streamEnded } = await reader.read();
            if (streamEnded) break;
            armTimeout();

            buffer += decoder.decode(value, { stream: true });

            // SSE 以行为单位；最后一段可能是不完整的行，留在缓冲里等下一块
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                handleLine(line);
                if (done) break;
            }
        }

        // 收尾：最后一行可能没有行尾符（例如结尾直接是 `data: [DONE]`）
        if (!done && buffer !== '') handleLine(buffer);

        const toolCalls: DeepSeekToolCall[] = [...calls.values()]
            .sort((a, b) => a.index - b.index)
            .map(call => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.arguments },
            }));

        const message: DeepSeekMessage = {
            role: 'assistant',
            content: content === '' ? null : content,
            ...(reasoning !== '' ? { reasoning_content: reasoning } : {}),
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        };

        const cache = usage ? readPromptCacheTokens(usage) : {};

        return {
            decision: toolCalls.length > 0
                ? this.translateToolCalls(toolCalls, message)
                : this.toFinalDecision(message),
            rawContent: content,
            reasoningContent: reasoning,
            ...(finishReason !== null ? { finishReason } : {}),
            ...(modelName !== undefined ? { modelName } : {}),
            // 用量只在最后一块到达。拿不到时保持缺省，而不是填 0 ——
            // 「响应没给这个数」与「这次一分钱没花」必须可区分。
            ...(usage !== undefined
                ? {
                    usage: {
                        promptTokens: usage.prompt_tokens,
                        completionTokens: usage.completion_tokens,
                        totalTokens: usage.total_tokens,
                        ...(cache.hit !== undefined ? { cacheHitTokens: cache.hit } : {}),
                        ...(cache.miss !== undefined ? { cacheMissTokens: cache.miss } : {}),
                    },
                }
                : {}),
        };
    }

    // ------------------------------------------------------------------
    // 请求侧翻译：ToolDefinition -> 原生 tools
    // ------------------------------------------------------------------

    private toDeepseekTool(tool: ToolDefinition): DeepseekToolDefinition {
        return {
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters as unknown as JsonSchemaObject,
            },
        };
    }

    // ------------------------------------------------------------------
    // 响应侧翻译：原生 tool_calls -> 内部决策 IR
    // ------------------------------------------------------------------

    /**
     * 翻译规则（见 design.md D2/D3/D4）：
     *   - 单个 request_replan 调用 -> Replan
     *   - 单个 batch 调用        -> BatchAction（携带的动作数组）
     *   - 单个工具调用           -> Action
     *   - 多个工具调用           -> BatchAction（顺序与响应一致）
     */
    private translateToolCalls(toolCalls: DeepSeekToolCall[], message: DeepSeekMessage): ModelDecision {
        if (toolCalls.length === 1) {
            const only = toolCalls[0]!;
            const name = only.function.name;

            if (name === REQUEST_REPLAN_TOOL) {
                const replan = this.toReplanDecision(only, message);
                if (replan) return replan;
            }
            if (name === BATCH_TOOL) {
                const batch = this.toBatchDecision(only, message);
                if (batch) return batch;
            }
        }

        const actions = toolCalls.map(tc => this.toAction(tc, message));
        if (actions.length === 1) {
            return actions[0]!;
        }
        return {
            type: 'BatchAction',
            actions: actions.map(action => ({
                tool: action.tool,
                params: action.params,
                thought: action.thought ?? '',
                ...(action.toolCallId !== undefined ? { toolCallId: action.toolCallId } : {}),
            })),
            thought: message.content?.trim() || `并发调用 ${actions.length} 个工具`,
        };
    }

    private toAction(tc: DeepSeekToolCall, message: DeepSeekMessage): Action {
        const thought = message.content?.trim() || `调用工具: ${tc.function.name}`;
        const parsed = this.parseArguments(tc.function.arguments);

        if (!parsed.ok) {
            // 参数不可解析时仍产出 Action，但带上失败说明：
            // 由运行时拒绝执行并记录失败观察，使模型有机会在下一轮修正。
            return {
                type: 'Action',
                tool: tc.function.name,
                params: {},
                thought,
                paramsParseError: `工具调用参数解析失败: ${parsed.raw} (${parsed.reason})`,
                ...(tc.id ? { toolCallId: tc.id } : {}),
            };
        }

        return {
            type: 'Action',
            tool: tc.function.name,
            params: parsed.value,
            thought,
            ...(tc.id ? { toolCallId: tc.id } : {}),
        };
    }

    private toReplanDecision(tc: DeepSeekToolCall, message: DeepSeekMessage): ModelDecision | null {
        const parsed = this.parseArguments(tc.function.arguments);
        if (!parsed.ok) return null;

        const { reason, newPlan } = parsed.value;
        if (!Array.isArray(newPlan) || newPlan.length === 0) return null;

        return {
            type: 'Replan',
            reason: typeof reason === 'string' && reason ? reason : '未提供重新规划的原因',
            newPlan: newPlan.map((step, index) => this.toPlanStep(step, index)),
            thought: message.content?.trim() || '请求重新规划',
        };
    }

    private toBatchDecision(tc: DeepSeekToolCall, message: DeepSeekMessage): ModelDecision | null {
        const parsed = this.parseArguments(tc.function.arguments);
        if (!parsed.ok) return null;

        const { actions } = parsed.value;
        if (!Array.isArray(actions)) return null;

        const mapped = actions.flatMap(entry => {
            if (!entry || typeof entry !== 'object') return [];
            const sub = entry as Record<string, unknown>;
            if (typeof sub.tool !== 'string' || !sub.tool) return [];
            const params = (sub.params && typeof sub.params === 'object' && !Array.isArray(sub.params))
                ? (sub.params as Record<string, unknown>)
                : {};
            return [{
                tool: sub.tool,
                params,
                thought: typeof sub.thought === 'string' ? sub.thought : '',
            }];
        });

        if (mapped.length === 0) return null;

        return {
            type: 'BatchAction',
            actions: mapped,
            thought: message.content?.trim() || `批量提交 ${mapped.length} 个动作`,
        };
    }

    private toPlanStep(step: unknown, index: number): PlanStep {
        const s = (step && typeof step === 'object') ? (step as Record<string, unknown>) : {};
        return {
            id: typeof s.id === 'string' && s.id ? s.id : `replan-step-${index + 1}`,
            description: typeof s.description === 'string' ? s.description : '',
            // 新步骤一律从 pending 开始，不接受模型自报已完成
            status: 'pending',
            dependsOn: Array.isArray(s.dependsOn)
                ? s.dependsOn.filter((d): d is string => typeof d === 'string')
                : [],
            completionCriteria: typeof s.completionCriteria === 'string' ? s.completionCriteria : '',
        };
    }

    private toFinalDecision(message: DeepSeekMessage): ModelDecision {
        const answer = message.content?.trim();
        return {
            type: 'Final',
            answer: answer && answer.length > 0 ? answer : '任务已完成',
            thought: '',
        };
    }

    /**
     * 解析工具调用参数。失败时不抛错，把原始内容与原因一并交回调用方，
     * 以便运行时形成可读的失败观察（见 tool-calling-protocol spec）。
     */
    private parseArguments(raw: string): ParseArgumentsResult {
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            return { ok: false, raw, reason: (e as Error).message };
        }

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { ok: false, raw, reason: '解析结果不是对象' };
        }

        return { ok: true, value: parsed as Record<string, unknown> };
    }

    /**
     * 将 ChatMessage 格式转换为 DeepSeek API 期望的格式
     */
    private formatMessage(msg: ChatMessage): Record<string, unknown> {
        const formatted: Record<string, unknown> = {
            role: msg.role,
            content: msg.content,
        };

        if (msg.role === 'assistant') {
            const assistantMsg = msg as AssistantMessage;

            // 保留 DeepSeek 特有的 reasoning_content
            if (assistantMsg.reasoning_content) {
                formatted.reasoning_content = assistantMsg.reasoning_content;
            }

            // tool_calls 必须独立于 reasoning_content 传递：
            // 运行时重建的助手消息不带 reasoning_content，若把这段放进上面
            // 那个判断里，工具调用会被静默丢掉，请求会被判为
            // 「content or tool_calls must be set」。
            if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
                formatted.tool_calls = assistantMsg.tool_calls;
            }
        }

        // 如果是 tool 消息，需要传递 tool_call_id
        if (msg.role === 'tool' && 'tool_call_id' in msg) {
            formatted.tool_call_id = (msg as any).tool_call_id;
        }

        return formatted;
    }
}

/**
 * 取错误响应的正文，塞进报错信息里。
 *
 * 流式路径上响应体是 SSE，不能像非流式那样先 `json()` 拿一份结构化错误，
 * 所以这里退化成读文本。读不出来时返回空串 —— 报错信息里少一段细节，
 * 总好过因为读不出正文而把真正的状态码丢掉。
 */
async function readErrorDetail(response: Response): Promise<string> {
    try {
        return await response.text();
    } catch {
        return '';
    }
}

/**
 * 取响应里的前缀缓存命中 / 未命中输入量。
 *
 * 两种形态实测同时出现（2026-09-22，deepseek-flash）：顶层的
 * `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`，以及 OpenAI 兼容的
 * `prompt_tokens_details.cached_tokens`。两个位置都看，取到即止。
 *
 * 未命中量缺失时由 `prompt_tokens - hit` 推出：该等式按定义成立，推算出来的值与
 * 响应直接给出的一样准。但只在「命中量已知」时才推 —— 两者都取不到时必须保持
 * 缺省，否则就把「不知道」写成了「未命中」。
 */
function readPromptCacheTokens(usage: DeepSeekUsage): { hit?: number; miss?: number } {
    const hit = usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens;
    const miss = usage.prompt_cache_miss_tokens
        ?? (typeof hit === 'number' ? Math.max(0, usage.prompt_tokens - hit) : undefined);

    return {
        ...(typeof hit === 'number' ? { hit } : {}),
        ...(typeof miss === 'number' ? { miss } : {}),
    };
}
