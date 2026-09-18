import type { AgentProvider, AgentProviderConfig, ModelResponse, DeepSeekResponse } from '../types/AgentProvider.js'
import type { ChatMessage, AssistantMessage } from '../types/Message.js'
import type { ModelDecision } from '../types/ReAct.js'

/**
 * @Deepseek
 * 
 * note: 1. body处需要修改，怎么把config的配置映射到deepseek官方文档接口上
 *       2. tools的设计：每次只能调用一个工具，所以响应里的tools怎么处理
 */
export class DeepSeekProvider implements AgentProvider {
    readonly name = 'deepseek'
    public config: AgentProviderConfig

    constructor(config: AgentProviderConfig) {
        this.config = {
            temperature: 0.2,
            maxTokens: 4096,
            ...config,
        };
    }

    updateConfig(config: Partial<AgentProviderConfig>): void {
        this.config = { ...this.config, ...config }
    }

    async decide(message: ChatMessage[]): Promise<ModelResponse> {
        // 将 config 中的参数映射到 DeepSeek API 的字段名
        const requestBody: Record<string, unknown> = {
            model: this.config.modelName,
            messages: message.map(msg => this.formatMessage(msg)),
        };
        if (this.config.temperature !== undefined) {
            requestBody.temperature = this.config.temperature;
        }
        if (this.config.maxTokens !== undefined) {
            requestBody.max_tokens = this.config.maxTokens;
        }

        // 超时控制
        const timeoutMs = this.config.timeout ?? 30000;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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

            const ResponseMessage = choice.message;
            // 处理 tool_calls 的情况（DeepSeek 支持 function calling）
            if (ResponseMessage.tool_calls && ResponseMessage.tool_calls.length > 0) {
                const decisions: ModelDecision[] = ResponseMessage.tool_calls.map(tc => ({
                    type: 'Action' as const,
                    tool: tc.function.name,
                    params: JSON.parse(tc.function.arguments),
                    thought: ResponseMessage.content || `调用工具: ${tc.function.name}`,
                }));

                const decision = decisions[0]!;

                return {
                    decision,
                    rawContent: JSON.stringify(ResponseMessage),
                    reasoningContent: ResponseMessage.reasoning_content ?? '',
                    finishReason: choice.finish_reason!,
                    modelName: data.model,
                    usage: {
                        promptTokens: data.usage.prompt_tokens,
                        completionTokens: data.usage.completion_tokens,
                        totalTokens: data.usage.total_tokens
                    },
                };
            }

            const rawContent = choice.message.content!.trim();

            let parsedJson: any;
            try {
                const cleanedContent = this.extractJsonFromResponse(rawContent);
                parsedJson = JSON.parse(cleanedContent);
            } catch (e) {
                throw new Error(
                    `无法解析模型返回的 JSON：${rawContent}\n解析错误：${(e as Error).message}`
                );
            }

            const decision = this.validateDecision(parsedJson);

            return {
                decision,
                rawContent,
                reasoningContent: ResponseMessage.reasoning_content ?? '',
                finishReason: choice.finish_reason!,
                modelName: data.model,
                usage: {
                    promptTokens: data.usage.prompt_tokens,
                    completionTokens: data.usage.completion_tokens,
                    totalTokens: data.usage.total_tokens
                },
            };

        } catch (err: any) {
            if (err.name === 'AbortError') {
                throw new Error(`DeepSeek 请求超时（${timeoutMs}ms）`);
            }
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    }


    /**
     * 从模型响应中提取 JSON 字符串
     * 处理模型可能在 ```json ... ``` 代码块中返回 JSON 的情况
     */
    private extractJsonFromResponse(content: string): string {
        // 尝试匹配 ```json ... ``` 代码块
        const jsonBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
        if (jsonBlockMatch) {
            return jsonBlockMatch[1]!.trim();
        }

        // 尝试匹配 ``` ... ``` 代码块（不带语言标记）
        const codeBlockMatch = content.match(/```\s*\n?([\s\S]*?)```/);
        if (codeBlockMatch) {
            return codeBlockMatch[1]!.trim();
        }

        // 如果没有代码块，直接返回原内容
        return content;
    }

    /**
     * 验证模型返回的 JSON 是否是合法的 ModelDecision
     */
    private validateDecision(json: any): ModelDecision {
        if (!json.type || !['Action', 'Replan', 'Final'].includes(json.type)) {
            throw new Error(
                `无效的决策类型："${json.type}"。必须是 Action、Replan 或 Final 之一。`
            );
        }

        switch (json.type) {
            case 'Action':
                if (!json.tool || typeof json.tool !== 'string') {
                    throw new Error('Action 必须有 tool 字段，且类型为字符串');
                }
                return {
                    type: 'Action',
                    tool: json.tool,
                    params: json.params || {},
                    thought: json.thought,
                };

            case 'Replan':
                if (!Array.isArray(json.newPlan)) {
                    throw new Error('Replan 必须有 newPlan 字段，且类型为数组');
                }
                return {
                    type: 'Replan',
                    reason: json.reason || '未提供重新规划的原因',
                    newPlan: json.newPlan.map((step: any, index: number) => ({
                        id: step.id || `replan-step-${index + 1}`,
                        description: step.description || '',
                        status: 'pending',
                        dependsOn: step.dependsOn || [],
                        completionCriteria: step.completionCriteria || '',
                    })),
                    thought: json.thought,
                };

            case 'Final':
                return {
                    type: 'Final',
                    answer: json.answer || '任务已完成',
                    thought: json.thought,
                };
            default:
                throw new Error(`未知的决策类型: ${json.type}`)
        }
    }


    /**
     * 将ChatMessage 格式转换为 DeepSeek API 期望的格式
     */
    private formatMessage(msg: ChatMessage): Record<string, unknown> {
        const formatted: Record<string, unknown> = {
            role: msg.role,
            content: msg.content,
        };

        // 保留 DeepSeek 特有的 reasoning_content
        if (msg.role === 'assistant' && 'reasoning_content' in msg) {
            const assistantMsg = msg as AssistantMessage;
            if (assistantMsg.reasoning_content) {
                formatted.reasoning_content = assistantMsg.reasoning_content;
            }
            // 如果有 tool_calls，也要传递
            if (assistantMsg.tool_calls) {
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


