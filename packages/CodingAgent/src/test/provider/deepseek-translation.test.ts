// src/test/provider/deepseek-translation.test.ts
//
// Provider 边界翻译的定向用例。
// 用 stub fetch 构造 DeepSeek 响应，避免依赖真实模型行为（并行调用、参数损坏
// 这类情形无法可靠地从真实模型复现）。
//
// fixture 是流式 SSE：生产的默认路径就是流式（见 AgentProviderConfig.stream），
// 这组用例必须跑在真正会走的那条路上。非流式兜底路径由
// src/test/provider/deepseek-streaming.test.ts 的单条用例守着。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DeepSeekProvider, DEFAULT_DEEPSEEK_BASE_URL } from '../../provider/deepseek.provider.js';
import type { DeepSeekUsage, ToolDefinition } from '../../types/AgentProvider.js';
import type { ChatMessage } from '../../types/Message.js';
import type { Action, BatchAction } from '../../types/ReAct.js';

const readFileTool: ToolDefinition = {
    name: 'read_file',
    description: '读取工作区内的文件内容',
    parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '文件路径' } },
        required: ['path'],
    },
};

/** 一条 SSE 数据行；结尾的 \n\n 是 SSE 的行分隔 */
function dataLine(payload: string): string {
    return `data: ${payload}\n\n`;
}

/**
 * 把一条 choice 的 message 拆成按协议到达的增量块。
 *
 * 工具调用的 name 与 arguments 刻意分成两片：真实流式响应就是这样到的，
 * 分片拼不回来是个只会在这条路上暴露的 bug。
 */
function deltaChunks(message: Record<string, any>): Array<Record<string, unknown>> {
    const deltas: Array<Record<string, unknown>> = [{ role: 'assistant', content: '' }];

    if (typeof message.content === 'string' && message.content !== '') {
        deltas.push({ content: message.content });
    }

    const calls: any[] = message.tool_calls ?? [];
    calls.forEach((call, index) => {
        const args: string = call.function.arguments;
        deltas.push({
            tool_calls: [{
                index,
                id: call.id,
                type: 'function',
                function: { name: call.function.name, arguments: args.slice(0, 5) },
            }],
        });
        if (args.length > 5) {
            deltas.push({ tool_calls: [{ index, function: { arguments: args.slice(5) } }] });
        }
    });

    return deltas;
}

/** 把一次完整响应包成流式 SSE */
function deepSeekResponse(
    choices: unknown[],
    usage: Partial<DeepSeekUsage> = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
): Response {
    const chunk = (delta: Record<string, unknown>, finishReason: string | null) =>
        dataLine(JSON.stringify({
            id: 'chatcmpl-test',
            object: 'chat.completion.chunk',
            created: 0,
            model: 'deepseek-chat',
            choices: [{ index: 0, delta, finish_reason: finishReason }],
        }));

    const lines: string[] = [];
    for (const choice of choices as Array<Record<string, any>>) {
        for (const delta of deltaChunks(choice.message)) {
            lines.push(chunk(delta, null));
        }
        // 用量只随最后一块到达
        lines.push(dataLine(JSON.stringify({
            id: 'chatcmpl-test',
            object: 'chat.completion.chunk',
            created: 0,
            model: 'deepseek-chat',
            choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }],
            usage,
        })));
    }
    lines.push('data: [DONE]\n\n');

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const line of lines) controller.enqueue(encoder.encode(line));
            controller.close();
        },
    });

    return new Response(body, { status: 200 });
}

function toolCallChoice(calls: Array<{ id: string; name: string; args: string }>) {
    return {
        index: 0,
        message: {
            role: 'assistant',
            content: null,
            tool_calls: calls.map(c => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: c.args },
            })),
        },
        finish_reason: 'tool_calls',
    };
}

function textChoice(content: string) {
    return {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
    };
}

describe('DeepSeekProvider 边界翻译', () => {
    let provider: DeepSeekProvider;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        provider = new DeepSeekProvider({ modelName: 'deepseek-chat', apiKey: 'test-key' });
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    /** 取最近一次请求的 requestBody */
    function lastRequestBody(): Record<string, any> {
        const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]!;
        return JSON.parse((call[1] as RequestInit).body as string);
    }

    const userMessage: ChatMessage[] = [{ role: 'user', content: '请读取 package.json' }];

    // ---- 请求侧：工具声明的下发 ----

    it('应该把传入的工具声明翻译为原生 tools 下发', async () => {
        fetchMock.mockResolvedValue(deepSeekResponse([textChoice('好的')]));

        await provider.decide(userMessage, [readFileTool]);

        const body = lastRequestBody();
        expect(body.tools).toBeDefined();
        const declared = body.tools.find((t: any) => t.function.name === 'read_file');
        expect(declared).toBeDefined();
        expect(declared.type).toBe('function');
        expect(declared.function.description).toBe(readFileTool.description);
        expect(declared.function.parameters.required).toEqual(['path']);
    });

    it('应该把控制流入口一并声明为工具', async () => {
        fetchMock.mockResolvedValue(deepSeekResponse([textChoice('好的')]));

        await provider.decide(userMessage, [readFileTool]);

        const names = lastRequestBody().tools.map((t: any) => t.function.name);
        expect(names).toContain('request_replan');
        expect(names).toContain('batch');
    });

    it('未传入工具时请求体不包含 tools 字段', async () => {
        fetchMock.mockResolvedValue(deepSeekResponse([textChoice('好的')]));

        await provider.decide(userMessage, []);

        expect('tools' in lastRequestBody()).toBe(false);
    });

    it('未传 baseUrl 时使用默认端点', () => {
        expect(provider.config.baseUrl).toBe(DEFAULT_DEEPSEEK_BASE_URL);
    });

    it('请求体中的助手消息携带工具调用与配对的工具结果', async () => {
        fetchMock.mockResolvedValue(deepSeekResponse([textChoice('好的')]));

        // 运行时重建的助手消息不带 reasoning_content —— 这正是
        // tool_calls 曾被静默丢掉、请求被判为 tool_calls must be set 的原因
        const history: ChatMessage[] = [
            { role: 'user', content: '请读取 package.json' },
            {
                role: 'assistant',
                content: null,
                tool_calls: [
                    {
                        index: 0,
                        id: 'call_wire',
                        type: 'function',
                        function: { name: 'read_file', arguments: '{"path":"package.json"}' },
                    },
                ],
            },
            { role: 'tool', tool_call_id: 'call_wire', name: 'read_file', content: '{"success":true}' },
        ];

        await provider.decide(history, [readFileTool]);

        const messages = lastRequestBody().messages as Array<Record<string, any>>;

        const assistant = messages.find(m => m.role === 'assistant')!;
        expect(assistant.tool_calls).toHaveLength(1);
        expect(assistant.tool_calls[0].id).toBe('call_wire');

        const toolResult = messages.find(m => m.role === 'tool')!;
        expect(toolResult.tool_call_id).toBe('call_wire');

        // 不变量：任何助手消息都必须有内容或有工具调用，否则服务端会直接拒绝
        for (const message of messages) {
            if (message.role !== 'assistant') continue;
            const hasContent = message.content !== null && message.content !== undefined;
            const hasCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
            expect(hasContent || hasCalls).toBe(true);
        }
    });

    // ---- 响应侧：工具调用翻译 ----

    it('单个工具调用翻译为动作决策并保留调用标识', async () => {
        fetchMock.mockResolvedValue(
            deepSeekResponse([toolCallChoice([{ id: 'call_abc123', name: 'read_file', args: '{"path":"package.json"}' }])]),
        );

        const response = await provider.decide(userMessage, [readFileTool]);
        const decision = response.decision as Action;

        expect(decision.type).toBe('Action');
        expect(decision.tool).toBe('read_file');
        expect(decision.params).toEqual({ path: 'package.json' });
        expect(decision.toolCallId).toBe('call_abc123');
    });

    it('多个工具调用按响应顺序翻译为批量动作决策', async () => {
        fetchMock.mockResolvedValue(
            deepSeekResponse([
                toolCallChoice([
                    { id: 'call_1', name: 'read_file', args: '{"path":"a.ts"}' },
                    { id: 'call_2', name: 'read_file', args: '{"path":"b.ts"}' },
                ]),
            ]),
        );

        const decision = (await provider.decide(userMessage, [readFileTool])).decision as BatchAction;

        expect(decision.type).toBe('BatchAction');
        expect(decision.actions).toHaveLength(2);
        expect(decision.actions.map(a => (a.params as any).path)).toEqual(['a.ts', 'b.ts']);
        expect(decision.actions.map(a => a.toolCallId)).toEqual(['call_1', 'call_2']);
    });

    it('无工具调用时回落为完成决策并取用响应文本', async () => {
        fetchMock.mockResolvedValue(deepSeekResponse([textChoice('package.json 是项目的清单文件。')]));

        const decision = (await provider.decide(userMessage, [readFileTool])).decision;

        expect(decision.type).toBe('Final');
        expect(decision.type === 'Final' && decision.answer).toContain('package.json');
    });

    it('重新规划入口的调用翻译为重新规划决策', async () => {
        const newPlan = JSON.stringify({
            reason: '文件不存在，需要先搜索',
            newPlan: [
                {
                    id: '1',
                    description: '搜索目标文件',
                    status: 'pending',
                    dependsOn: [],
                    completionCriteria: '找到文件路径',
                },
            ],
        });
        fetchMock.mockResolvedValue(
            deepSeekResponse([toolCallChoice([{ id: 'call_replan', name: 'request_replan', args: newPlan }])]),
        );

        const decision = (await provider.decide(userMessage, [readFileTool])).decision;

        expect(decision.type).toBe('Replan');
        if (decision.type === 'Replan') {
            expect(decision.reason).toContain('搜索');
            expect(decision.newPlan).toHaveLength(1);
        }
    });

    it('批量入口的调用翻译为批量动作决策', async () => {
        const args = JSON.stringify({
            actions: [
                { tool: 'read_file', params: { path: 'a.ts' } },
                { tool: 'read_file', params: { path: 'b.ts' } },
            ],
        });
        fetchMock.mockResolvedValue(
            deepSeekResponse([toolCallChoice([{ id: 'call_batch', name: 'batch', args }])]),
        );

        const decision = (await provider.decide(userMessage, [readFileTool])).decision as BatchAction;

        expect(decision.type).toBe('BatchAction');
        expect(decision.actions.map(a => (a.params as any).path)).toEqual(['a.ts', 'b.ts']);
    });

    it('参数不是合法 JSON 时标记解析失败而不抛错', async () => {
        fetchMock.mockResolvedValue(
            deepSeekResponse([toolCallChoice([{ id: 'call_bad', name: 'read_file', args: '{"path": "trunc' }])]),
        );

        const response = await provider.decide(userMessage, [readFileTool]);
        const decision = response.decision as Action;

        expect(decision.type).toBe('Action');
        expect(decision.tool).toBe('read_file');
        expect(decision.paramsParseError).toBeTruthy();
        // 原始调用内容与失败原因都要留下，供运行时形成可读观察
        expect(decision.paramsParseError).toContain('{"path": "trunc');
    });

    // ---- 响应侧：前缀缓存命中量的透传 ----

    it('响应里的缓存命中与未命中量透传为 cacheHitTokens / cacheMissTokens', async () => {
        // 字段取值来自 2026-09-22 的真实响应（deepseek-flash）：两种形态同时出现
        fetchMock.mockResolvedValue(
            deepSeekResponse([textChoice('好的')], {
                prompt_tokens: 814,
                completion_tokens: 1,
                total_tokens: 815,
                prompt_tokens_details: { cached_tokens: 640 },
                prompt_cache_hit_tokens: 640,
                prompt_cache_miss_tokens: 174,
            }),
        );

        const usage = (await provider.decide(userMessage, [readFileTool])).usage;

        expect(usage?.promptTokens).toBe(814);
        expect(usage?.cacheHitTokens).toBe(640);
        expect(usage?.cacheMissTokens).toBe(174);
    });

    it('只提供 cached_tokens 时由输入量推出未命中量', async () => {
        fetchMock.mockResolvedValue(
            deepSeekResponse([textChoice('好的')], {
                prompt_tokens: 1000,
                completion_tokens: 1,
                total_tokens: 1001,
                prompt_tokens_details: { cached_tokens: 768 },
            }),
        );

        const usage = (await provider.decide(userMessage, [readFileTool])).usage;

        expect(usage?.cacheHitTokens).toBe(768);
        expect(usage?.cacheMissTokens).toBe(232);
    });

    it('响应未提供缓存字段时两个值都缺省，而不是填 0', async () => {
        fetchMock.mockResolvedValue(deepSeekResponse([textChoice('好的')]));

        const usage = (await provider.decide(userMessage, [readFileTool])).usage;

        // 「响应没给这个数」与「缓存一次都没命中」必须可区分
        expect(usage?.cacheHitTokens).toBeUndefined();
        expect(usage?.cacheMissTokens).toBeUndefined();
    });
});
