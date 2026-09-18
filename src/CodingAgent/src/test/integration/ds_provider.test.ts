// tests/integration/deepseek-provider.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { DeepSeekProvider } from '../../provider/deepseek.provider.js';
import type { ChatMessage } from '../../types/Message.js';

describe('DeepSeek Provider 集成测试', () => {
    let provider: DeepSeekProvider;

    beforeAll(() => {
        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey) {
            throw new Error('请设置 DEEPSEEK_API_KEY 环境变量');
        }

        provider = new DeepSeekProvider({
            apiKey,
            baseUrl: 'https://api.deepseek.com/v1/chat/completions',
            modelName: 'deepseek-chat',
            temperature: 0.1,
            maxTokens: 2048,
        });
    });

    it('应该能正常连接并返回 Final 决策', async () => {
        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: `你是一个 AI 编码助手。请严格按以下 JSON 格式回复：
{
    "type": "Final",
    "answer": "你的回答",
    "thought": "你的思考过程"
}

不要包含其他任何内容，只返回 JSON。`,
            },
            {
                role: 'user',
                content: '请用一句话介绍 JavaScript 的闭包。',
            },
        ];

        const response = await provider.decide(messages);

        console.log(' 原始响应:', response.rawContent);
        console.log(' Token 用量:', response.usage);

        expect(response.decision.type).toBe('Final');
        expect(response.decision).toHaveProperty('answer');
        expect(response.usage!.totalTokens).toBeGreaterThan(0);
    }, 30000); // 30秒超时

    it('应该能返回 Action 决策（工具调用）', async () => {
        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: `你是一个 AI 编码助手。你有以下工具可用：
- read_file: 读取文件内容
- write_file: 写入文件内容
- run_command: 执行 shell 命令

请严格按以下 JSON 格式回复：
{
    "type": "Action",
    "tool": "工具名称",
    "params": { "参数名": "参数值" },
    "thought": "为什么选择这个工具"
}

不要包含其他任何内容，只返回 JSON。`,
            },
            {
                role: 'user',
                content: '我想查看 package.json 文件的内容，请帮我读取。',
            },
        ];

        const response = await provider.decide(messages);

        console.log('📝 原始响应:', response.rawContent);
        console.log('🎯 决策类型:', response.decision.type);

        expect(response.decision.type).toBe('Action');
        if (response.decision.type === 'Action') {
            expect(response.decision.tool).toBe('read_file');
            expect(response.decision.params).toHaveProperty('path');
        }
    }, 30000);

    it('应该能正确处理流式推理（reasoning_content）', async () => {
        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: `你是一个 AI 编码助手。请严格按以下 JSON 格式回复：
{
    "type": "Final",
    "answer": "你的回答",
    "thought": "你的思考过程"
}

不要包含其他任何内容，只返回 JSON。`,
            },
            {
                role: 'user',
                content: '请解释一下 React 的 useEffect 钩子。',
            },
        ];

        const response = await provider.decide(messages);

        console.log('🧠 推理内容:', response.reasoningContent);
        console.log('📝 回答内容:', response.decision.type === 'Final' ? response.decision.answer : '');

        // DeepSeek 可能会返回 reasoning_content
        if (response.reasoningContent) {
            expect(typeof response.reasoningContent).toBe('string');
            expect(response.reasoningContent.length).toBeGreaterThan(0);
        }
    }, 30000);

    it('应该能处理 Replan 决策', async () => {
        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: `你是一个 AI 编码助手。当你发现当前方案不可行时，可以重新规划。

请严格按以下 JSON 格式回复：
{
    "type": "Replan",
    "reason": "重新规划的原因",
    "newPlan": [
        {
            "id": "step-1",
            "description": "步骤描述",
            "status": "pending",
            "dependsOn": [],
            "completionCriteria": "完成标准"
        }
    ],
    "thought": "你的思考过程"
}

不要包含其他任何内容，只返回 JSON。`,
            },
            {
                role: 'user',
                content: '之前的方案有问题，请重新规划一个三步计划来完成一个 Web 服务器项目。',
            },
        ];

        const response = await provider.decide(messages);

        console.log('📝 原始响应:', response.rawContent);

        expect(response.decision.type).toBe('Replan');
        if (response.decision.type === 'Replan') {
            expect(Array.isArray(response.decision.newPlan)).toBe(true);
            expect(response.decision.newPlan.length).toBeGreaterThanOrEqual(1);
            expect(response.decision.reason).toBeTruthy();
        }
    }, 30000);

    it('应该能处理 API 错误（无效的 API Key）', async () => {
        const badProvider = new DeepSeekProvider({
            apiKey: 'invalid-key-12345',
            baseUrl: 'https://api.deepseek.com/v1/chat/completions',
            modelName: 'deepseek-chat',
        });

        const messages: ChatMessage[] = [
            { role: 'user', content: 'hello' },
        ];

        await expect(badProvider.decide(messages)).rejects.toThrow();
    }, 15000);

    it('应该能处理超时错误', async () => {
        const timeoutProvider = new DeepSeekProvider({
            apiKey: process.env.DEEPSEEK_API_KEY!,
            baseUrl: 'https://api.deepseek.com/v1/chat/completions',
            modelName: 'deepseek-chat',
            timeout: 100, // 1ms 超时
        });

        const messages: ChatMessage[] = [
            { role: 'user', content: '请写一篇长文章' },
        ];

        await expect(timeoutProvider.decide(messages)).rejects.toThrow();
    }, 5000);
});