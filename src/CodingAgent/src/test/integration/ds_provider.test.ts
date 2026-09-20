// src/test/integration/ds_provider.test.ts
//
// 真实 API 的 Provider 集成测试。
// 断言的是「协议」：工具声明是否下发、模型的原生工具调用是否被翻译成运行时决策、
// 没有工具调用时是否回落为完成决策。确定性更强的情形（并行调用、参数损坏）见
// src/test/provider/deepseek-translation.test.ts。
import { describe, it, expect, beforeAll } from 'vitest';
import { DeepSeekProvider } from '../../provider/deepseek.provider.js';
import type { ToolDefinition } from '../../types/AgentProvider.js';
import type { ChatMessage } from '../../types/Message.js';
import type { Action } from '../../types/ReAct.js';

const readFileTool: ToolDefinition = {
    name: 'read_file',
    description: '读取工作区内的文件内容',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: '相对于工作区根目录的文件路径' },
        },
        required: ['path'],
    },
};

describe('DeepSeek Provider 集成测试', () => {
    let provider: DeepSeekProvider;

    beforeAll(() => {
        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey) {
            throw new Error('请设置 DEEPSEEK_API_KEY 环境变量');
        }

        // 刻意不传 baseUrl，以同时覆盖默认端点
        provider = new DeepSeekProvider({
            apiKey,
            modelName: 'deepseek-chat',
            temperature: 0.1,
            maxTokens: 2048,
        });
    });

    it('应该下发工具声明并返回带调用标识的动作决策', async () => {
        const messages: ChatMessage[] = [
            { role: 'system', content: '你是一个编码助手。需要读写文件时必须调用工具。' },
            { role: 'user', content: '请读取 package.json 的内容。' },
        ];

        const response = await provider.decide(messages, [readFileTool]);

        expect(response.decision.type).toBe('Action');
        const action = response.decision as Action;
        expect(action.tool).toBe('read_file');
        expect(action.params).toHaveProperty('path');
        // 调用标识必须被保留，消息序列才能靠它把工具结果与调用配对
        expect(action.toolCallId).toBeTruthy();
    }, 30000);

    it('应该在无需工具时回落为完成决策', async () => {
        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: '你是一个编码助手。只有需要读写文件时才调用工具；纯知识性问题请直接回答。',
            },
            { role: 'user', content: '请用一句话说明 JavaScript 的闭包是什么。' },
        ];

        const response = await provider.decide(messages, [readFileTool]);

        expect(response.decision.type).toBe('Final');
        if (response.decision.type === 'Final') {
            expect(response.decision.answer.length).toBeGreaterThan(0);
        }
    }, 30000);

    it('应该在未提供任何工具时仍返回完成决策', async () => {
        const messages: ChatMessage[] = [
            { role: 'user', content: '请用一句话说明什么是向量检索。' },
        ];

        const response = await provider.decide(messages, []);

        expect(response.decision.type).toBe('Final');
    }, 30000);

    it('应该返回用量并保留思考内容', async () => {
        const messages: ChatMessage[] = [
            { role: 'user', content: '请用一句话解释 React 的 useEffect 钩子。' },
        ];

        const response = await provider.decide(messages, []);

        // 用量是运行状态累计值的唯一来源，必须存在
        expect(response.usage).toBeDefined();
        expect(response.usage!.totalTokens).toBeGreaterThan(0);
        expect(response.usage!.promptTokens).toBeGreaterThan(0);

        if (response.reasoningContent) {
            expect(typeof response.reasoningContent).toBe('string');
        }
    }, 30000);

    it('应该能处理 API 错误（无效的 API Key）', async () => {
        const badProvider = new DeepSeekProvider({
            apiKey: 'invalid-key-12345',
            modelName: 'deepseek-chat',
        });

        const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }];

        await expect(badProvider.decide(messages, [])).rejects.toThrow();
    }, 15000);

    it('应该能处理超时错误', async () => {
        const timeoutProvider = new DeepSeekProvider({
            apiKey: process.env.DEEPSEEK_API_KEY!,
            modelName: 'deepseek-chat',
            timeout: 100,
        });

        const messages: ChatMessage[] = [{ role: 'user', content: '请写一篇长文章' }];

        await expect(timeoutProvider.decide(messages, [])).rejects.toThrow();
    }, 5000);
});
