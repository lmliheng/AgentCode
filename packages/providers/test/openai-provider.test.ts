// src/test/provider/openai-provider.test.ts
//
// OpenAI 兼容端点。
//
// 这一份测的不是协议翻译本身（那套与 DeepSeek 共用，见 deepseek-translation.test.ts），
// 而是「它确实是一个独立的提供方」：端点、厂商标、工厂函数、以及 baseUrl 能不能被
// 指到本机服务上 —— 后者是它最有用的地方（Ollama / vLLM 都是这套协议）。
import { describe, it, expect, afterEach, vi } from 'vitest';
import { OpenAIProvider, DEFAULT_OPENAI_BASE_URL } from '../src/openai.provider.js';
import { DeepSeekProvider, DEFAULT_DEEPSEEK_BASE_URL } from '../src/deepseek.provider.js';
import { createProvider, PROVIDER_API_KEY_ENV } from '../src/Provider.js';
import type { ToolDefinition } from '@lmliheng/acode-core';
import type { ChatMessage } from '@lmliheng/acode-core';

const readFileTool: ToolDefinition = {
    name: 'read_file',
    description: '读取工作区内的文件内容',
    parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '文件路径' } },
        required: ['path'],
    },
};

const messages: ChatMessage[] = [
    { role: 'system', content: '你是编码助手' },
    { role: 'user', content: '读一下 a.ts' },
];

/** 非流式的完整响应：一条工具调用 */
function toolCallResponse(name = 'read_file', args = '{"path":"a.ts"}'): Response {
    return new Response(JSON.stringify({
        choices: [{
            message: {
                role: 'assistant',
                content: '',
                tool_calls: [{ id: 'call-1', type: 'function', function: { name, arguments: args } }],
            },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** 记录请求并返回一次响应 */
function stubFetch(response: Response | (() => Response)) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return typeof response === 'function' ? response() : response;
    }));
    return calls;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('OpenAI 兼容提供方', () => {
    it('默认打到 OpenAI 端点，授权头与请求体按 chat/completions 协议给出', async () => {
        const calls = stubFetch(toolCallResponse());
        const provider = new OpenAIProvider({ modelName: 'gpt-4o', apiKey: 'sk-test', stream: false, temperature: 0 });

        const result = await provider.decide(messages, [readFileTool]);

        expect(calls).toHaveLength(1);
        expect(calls[0]!.url).toBe(DEFAULT_OPENAI_BASE_URL);

        const headers = calls[0]!.init.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer sk-test');

        const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, any>;
        expect(body.model).toBe('gpt-4o');
        expect(body.stream).toBeUndefined();
        // 工具声明随请求下发，且控制流入口（重新规划/批量）也在
        const names = (body.tools as Array<{ function: { name: string } }>).map(t => t.function.name);
        expect(names).toContain('read_file');
        expect(names).toContain('request_replan');
        expect(names).toContain('batch');

        // 继承来的翻译仍然生效：tool_calls -> Action
        expect(result.decision).toMatchObject({ type: 'Action', tool: 'read_file', params: { path: 'a.ts' } });
        expect(result.usage?.totalTokens).toBe(15);
    });

    it('baseUrl 可以被指到本机服务（Ollama / vLLM 都是这套协议）', async () => {
        const calls = stubFetch(toolCallResponse());
        const provider = new OpenAIProvider({
            modelName: 'qwen2.5-coder',
            apiKey: 'local',
            baseUrl: 'http://127.0.0.1:11434/v1/chat/completions',
            stream: false,
        });

        await provider.decide(messages, [readFileTool]);

        expect(calls[0]!.url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    });

    it('报错里说的是 OpenAI 而不是 DeepSeek —— 谁拒了这次请求要看得出', async () => {
        stubFetch(() => new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 }));

        const provider = new OpenAIProvider({ modelName: 'gpt-4o', apiKey: 'bad', stream: false });

        await expect(provider.decide(messages, [])).rejects.toThrow(/OpenAI 调用失败：401/);
    });

    it('是独立的提供方：name 与默认端点都不与 DeepSeek 混同', () => {
        const openai = new OpenAIProvider({ modelName: 'gpt-4o', apiKey: 'k' });
        const deepseek = new DeepSeekProvider({ modelName: 'deepseek-chat', apiKey: 'k' });

        expect(openai.name).toBe('openai');
        expect(deepseek.name).toBe('deepseek');
        expect(openai.config.baseUrl).toBe(DEFAULT_OPENAI_BASE_URL);
        expect(deepseek.config.baseUrl).toBe(DEFAULT_DEEPSEEK_BASE_URL);
        expect(DEFAULT_OPENAI_BASE_URL).not.toBe(DEFAULT_DEEPSEEK_BASE_URL);
    });

    it('工厂函数能造出它，且密钥的环境变量名各归各', () => {
        const provider = createProvider('openai', { modelName: 'gpt-4o', apiKey: 'k' });
        expect(provider.name).toBe('openai');
        expect(PROVIDER_API_KEY_ENV.openai).toBe('OPENAI_API_KEY');
        expect(PROVIDER_API_KEY_ENV.deepseek).toBe('DEEPSEEK_API_KEY');
    });
});
