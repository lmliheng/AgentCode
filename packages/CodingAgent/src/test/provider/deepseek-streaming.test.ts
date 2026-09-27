// src/test/provider/deepseek-streaming.test.ts
//
// 流式响应的 SSE 解析用例。
// 用 stub fetch 直接喂字节流：分块边界是这条路上唯一真正难的部分（多字节汉字
// 被切开、JSON 行被切开、工具调用碎片横跨多块），这些都无法靠真实模型稳定复现。
// 真实 API 的流式行为见 src/test/integration/ds_provider.test.ts。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DeepSeekProvider } from '../../provider/deepseek.provider.js';
import type { ToolDefinition } from '../../types/AgentProvider.js';
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

const userMessage: ChatMessage[] = [{ role: 'user', content: '请读取 package.json' }];

/** 一条 SSE 数据行；结尾的 \n\n 是 SSE 的行分隔 */
function dataLine(payload: string): string {
    return `data: ${payload}\n\n`;
}

/** 造一块 chunk（object 固定为 chat.completion.chunk） */
function chunk(
    delta: Record<string, unknown>,
    finishReason: string | null = null,
    usage?: Record<string, unknown>,
): string {
    return JSON.stringify({
        id: 'chunk-test',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'deepseek-chat',
        choices: [{ index: 0, delta, finish_reason: finishReason }],
        ...(usage !== undefined ? { usage } : {}),
    });
}

/**
 * 把若干片段包成一个流式 Response。
 *
 * 片段可以是字符串也可以是原始字节 —— 「切在多字节字符中间」这个用例只能靠
 * 字节切片表达，按字符串切永远切不出半个汉字。
 */
function sseResponse(pieces: Array<string | Uint8Array>, status = 200): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const piece of pieces) {
                controller.enqueue(typeof piece === 'string' ? encoder.encode(piece) : piece);
            }
            controller.close();
        },
    });
    return new Response(body, { status });
}

describe('DeepSeekProvider 流式解析', () => {
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

    // ---- 请求侧：是否走流式 ----

    it('默认请求流式响应', async () => {
        fetchMock.mockResolvedValue(
            sseResponse([dataLine(chunk({ content: '好' })), 'data: [DONE]\n\n']),
        );

        await provider.decide(userMessage, []);

        expect(lastRequestBody().stream).toBe(true);
    });

    it('关闭流式时走整包解析，请求体不带 stream', async () => {
        const plain = new DeepSeekProvider({
            modelName: 'deepseek-chat',
            apiKey: 'test-key',
            stream: false,
        });
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                id: 'chatcmpl-test',
                object: 'chat.completion',
                created: 0,
                model: 'deepseek-chat',
                choices: [
                    {
                        index: 0,
                        message: { role: 'assistant', content: '整包应答' },
                        finish_reason: 'stop',
                    },
                ],
                usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
            }),
        } as unknown as Response);

        const response = await plain.decide(userMessage, []);

        expect('stream' in lastRequestBody()).toBe(false);
        expect(response.decision.type).toBe('Final');
        expect(response.rawContent).toBe('整包应答');
    });

    // ---- 响应侧：正文与用量 ----

    it('把正文分片拼成完成决策，并按到达顺序回调增量', async () => {
        const deltas: string[] = [];
        fetchMock.mockResolvedValue(sseResponse([
            dataLine(chunk({ role: 'assistant', content: '' })),
            dataLine(chunk({ content: '你好' })),
            dataLine(chunk({ content: '，世界' })),
            dataLine(chunk({}, 'stop', {
                prompt_tokens: 10,
                completion_tokens: 4,
                total_tokens: 14,
            })),
            'data: [DONE]\n\n',
        ]));

        const response = await provider.decide(userMessage, [], (delta) => {
            if (delta.content) deltas.push(delta.content);
        });

        expect(deltas).toEqual(['你好', '，世界']);
        expect(response.decision.type).toBe('Final');
        expect(response.decision.type === 'Final' && response.decision.answer).toBe('你好，世界');
        expect(response.rawContent).toBe('你好，世界');
        expect(response.finishReason).toBe('stop');
        expect(response.modelName).toBe('deepseek-chat');
        expect(response.usage).toEqual({
            promptTokens: 10,
            completionTokens: 4,
            totalTokens: 14,
        });
    });

    it('流式下同样透传前缀缓存命中量', async () => {
        // 取值来自 2026-09-22 的真实响应形态，与非流式那条路保持一致
        fetchMock.mockResolvedValue(sseResponse([
            dataLine(chunk({ content: '好' })),
            dataLine(chunk({}, 'stop', {
                prompt_tokens: 814,
                completion_tokens: 1,
                total_tokens: 815,
                prompt_tokens_details: { cached_tokens: 640 },
                prompt_cache_hit_tokens: 640,
                prompt_cache_miss_tokens: 174,
            })),
        ]));

        const usage = (await provider.decide(userMessage, [])).usage;

        expect(usage?.cacheHitTokens).toBe(640);
        expect(usage?.cacheMissTokens).toBe(174);
    });

    it('流里没有用量时保持缺省，而不是填 0', async () => {
        fetchMock.mockResolvedValue(sseResponse([
            dataLine(chunk({ content: '好' })),
            dataLine(chunk({}, 'stop')),
            'data: [DONE]\n\n',
        ]));

        const response = await provider.decide(userMessage, []);

        // 「响应没给这个数」与「这次一分钱没花」必须可区分
        expect(response.usage).toBeUndefined();
        expect(response.rawContent).toBe('好');
    });

    it('思考链与正文分别累加，并各自回调', async () => {
        const deltas: Array<{ content?: string; reasoningContent?: string }> = [];
        fetchMock.mockResolvedValue(sseResponse([
            dataLine(chunk({ reasoning_content: '先想' })),
            dataLine(chunk({ reasoning_content: '一下' })),
            dataLine(chunk({ content: '答案是' })),
            dataLine(chunk({}, 'stop')),
        ]));

        const response = await provider.decide(userMessage, [], (delta) => deltas.push(delta));

        expect(deltas).toEqual([
            { reasoningContent: '先想' },
            { reasoningContent: '一下' },
            { content: '答案是' },
        ]);
        expect(response.reasoningContent).toBe('先想一下');
        expect(response.rawContent).toBe('答案是');
    });

    // ---- 分块边界 ----

    it('分块切开多字节汉字时不产生乱码', async () => {
        const text = dataLine(chunk({ content: '' })) + dataLine(chunk({ content: '中文测试' }));
        const bytes = new TextEncoder().encode(text);

        // 「中」之前的 JSON 全是 ASCII，所以字符下标就是字节下标
        const cut = text.indexOf('中') + 1;
        expect(bytes[cut - 1]).toBeGreaterThanOrEqual(0x80);   // 确认真的切在多字节字符中间

        fetchMock.mockResolvedValue(sseResponse([bytes.slice(0, cut), bytes.slice(cut)]));

        const response = await provider.decide(userMessage, []);

        expect(response.rawContent).toBe('中文测试');
        expect(response.rawContent).not.toContain('\ufffd');
    });

    it('SSE 行被任意位置切开时，残行留在缓冲里等下一块', async () => {
        const text =
            dataLine(chunk({ content: '第一段' })) +
            dataLine(chunk({ content: '第二段' }, 'stop')) +
            'data: [DONE]\n\n';
        const bytes = new TextEncoder().encode(text);

        // 三块：切点落在 data 行与 JSON 的内部，且可能落在汉字中间
        fetchMock.mockResolvedValue(
            sseResponse([bytes.slice(0, 40), bytes.slice(40, 90), bytes.slice(90)]),
        );

        const response = await provider.decide(userMessage, []);

        expect(response.rawContent).toBe('第一段第二段');
    });

    it('结尾没有行尾符时仍能识别 [DONE]', async () => {
        fetchMock.mockResolvedValue(sseResponse([
            dataLine(chunk({ content: '好的' })),
            'data: [DONE]',        // 故意不带行尾
        ]));

        const response = await provider.decide(userMessage, []);

        expect(response.rawContent).toBe('好的');
    });

    it('兼容 CRLF 行尾', async () => {
        fetchMock.mockResolvedValue(sseResponse([
            `data: ${chunk({ content: 'CRLF' })}\r\n\r\n`,
            'data: [DONE]\r\n\r\n',
        ]));

        expect((await provider.decide(userMessage, [])).rawContent).toBe('CRLF');
    });

    it('忽略 keep-alive 注释与非 data 行', async () => {
        fetchMock.mockResolvedValue(sseResponse([
            ': keep-alive\n\n',
            'event: message\n',
            dataLine(chunk({ content: '收到' })),
        ]));

        expect((await provider.decide(userMessage, [])).rawContent).toBe('收到');
    });

    // ---- 响应侧：工具调用碎片 ----

    it('把按 index 分片的工具调用拼成一次调用', async () => {
        fetchMock.mockResolvedValue(sseResponse([
            dataLine(chunk({
                tool_calls: [{
                    index: 0,
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'read_file', arguments: '{"pa' },
                }],
            })),
            // 第二片里重发整名：把 name 也累加会得到 "read_fileread_file"
            dataLine(chunk({
                tool_calls: [{ index: 0, function: { name: 'read_file', arguments: 'th":"a.ts"}' } }],
            })),
            dataLine(chunk({}, 'tool_calls')),
            'data: [DONE]\n\n',
        ]));

        const decision = (await provider.decide(userMessage, [readFileTool])).decision as Action;

        expect(decision.type).toBe('Action');
        expect(decision.tool).toBe('read_file');
        expect(decision.params).toEqual({ path: 'a.ts' });
        expect(decision.toolCallId).toBe('call_1');
    });

    it('按 index 区分同一块里交错的多个并发调用', async () => {
        fetchMock.mockResolvedValue(sseResponse([
            dataLine(chunk({
                tool_calls: [
                    { index: 0, id: 'call_a', function: { name: 'read_file', arguments: '{"path":"a' } },
                    { index: 1, id: 'call_b', function: { name: 'read_file', arguments: '{"path":"b' } },
                ],
            })),
            // 故意的乱序到达：第二个碎片先给 index 1
            dataLine(chunk({
                tool_calls: [
                    { index: 1, function: { arguments: '.ts"}' } },
                    { index: 0, function: { arguments: '.ts"}' } },
                ],
            })),
            dataLine(chunk({}, 'tool_calls')),
        ]));

        const decision = (await provider.decide(userMessage, [readFileTool])).decision as BatchAction;

        expect(decision.type).toBe('BatchAction');
        expect(decision.actions.map(a => (a.params as any).path)).toEqual(['a.ts', 'b.ts']);
        expect(decision.actions.map(a => a.toolCallId)).toEqual(['call_a', 'call_b']);
    });

    it('分片的工具调用参数不是合法 JSON 时标记解析失败而不抛错', async () => {
        fetchMock.mockResolvedValue(sseResponse([
            dataLine(chunk({
                tool_calls: [{ index: 0, id: 'call_bad', function: { name: 'read_file', arguments: '{"path": "trunc' } }],
            })),
            dataLine(chunk({}, 'tool_calls')),
        ]));

        const decision = (await provider.decide(userMessage, [readFileTool])).decision as Action;

        expect(decision.type).toBe('Action');
        expect(decision.tool).toBe('read_file');
        expect(decision.paramsParseError).toContain('{"path": "trunc');
    });

    // ---- 失败路径 ----

    it('无法解析的数据块报错，而不是静默跳过吞掉内容', async () => {
        fetchMock.mockResolvedValue(sseResponse([
            dataLine(chunk({ content: '前半' })),
            dataLine('{"choices":'),
        ]));

        await expect(provider.decide(userMessage, [])).rejects.toThrow(/无法解析的数据块/);
    });

    it('流式下非 2xx 仍报出状态码与响应正文', async () => {
        fetchMock.mockResolvedValue(
            new Response('{"error":"invalid api key"}', { status: 401 }),
        );

        await expect(provider.decide(userMessage, [])).rejects.toThrow(/401/);
    });
});
