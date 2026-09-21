// src/test/runtime/message-sequence.test.ts
//
// 覆盖 agent-runtime spec：
//   - 对话历史以真实消息序列维护（工具调用与结果成对）
//   - 决策记录可重建为可提交的消息序列
//   - 模型用量记录为可观测量
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentRuntime, sanitizeMessageSequence } from '../../runtime/agent.runtime.js';
import { ReadFileTool } from '../../tools/read_file.js';
import { CreateFileTool } from '../../tools/create_file.js';
import { createTestWorkspace, cleanupTestWorkspace, initialPlanDecision } from '../setup.js';
import type {
    AgentProvider,
    AgentProviderConfig,
    ModelResponse,
    TokenUsage,
} from '../../types/AgentProvider.js';
import type { ChatMessage, AssistantMessage, ToolMessage } from '../../types/Message.js';
import type { ModelDecision } from '../../types/ReAct.js';

/** 记录每次请求收到的消息序列，并按脚本逐轮返回决策 */
class CapturingProvider implements AgentProvider {
    readonly name = 'capturing';
    config: AgentProviderConfig = { modelName: 'capturing', temperature: 0, maxTokens: 100 };
    readonly calls: ChatMessage[][] = [];
    private readonly script: Array<{ decision: ModelDecision; usage?: TokenUsage }>;
    private index = 0;

    constructor(script: Array<{ decision: ModelDecision; usage?: TokenUsage }>) {
        // 脚本第一位留给规划轮：运行时进入循环前会先请求一次初始计划
        this.script = [
            {
                decision: initialPlanDecision(),
                usage: { promptTokens: 4, completionTokens: 1, totalTokens: 5 },
            },
            ...script,
        ];
    }

    updateConfig(): void {
        // 测试用，无需实现
    }

    async decide(messages: ChatMessage[]): Promise<ModelResponse> {
        this.calls.push(messages);
        const entry = this.script[this.index];
        this.index += 1;

        const decision: ModelDecision = entry?.decision ?? { type: 'Final', answer: '结束' };
        return {
            decision,
            rawContent: '',
            ...(entry?.usage ? { usage: entry.usage } : {}),
        };
    }
}

describe('真实消息序列', () => {
    let workspaceDir: string;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({ 'src/a.ts': 'export const a = 1;\n' });
    });

    afterEach(() => {
        cleanupTestWorkspace(workspaceDir);
    });

    function toolMessages(messages: ChatMessage[]): ToolMessage[] {
        return messages.filter((m): m is ToolMessage => m.role === 'tool');
    }

    function assistantWithCalls(messages: ChatMessage[]): AssistantMessage[] {
        return messages.filter(
            (m): m is AssistantMessage => m.role === 'assistant' && (m.tool_calls?.length ?? 0) > 0,
        );
    }

    it('某一轮请求中工具结果与对应调用成对', async () => {
        const provider = new CapturingProvider([
            {
                decision: {
                    type: 'Action',
                    tool: 'read_file',
                    params: { path: 'src/a.ts' },
                    thought: '读取源码',
                    toolCallId: 'call_real_1',
                },
            },
            { decision: { type: 'Final', answer: '完成' } },
        ]);

        const runtime = new AgentRuntime(provider, [new ReadFileTool()], {
            workspacePath: workspaceDir,
            maxIterations: 5,
        });
        await runtime.run('读取 src/a.ts');

        // calls[0] 是规划轮；calls[1] 是进入循环后的第一轮，此时还没有任何历史；
        // 第二次循环请求才带上了第一次的调用与结果
        const secondLoop = provider.calls[2];
        expect(secondLoop).toBeDefined();

        const assistants = assistantWithCalls(secondLoop!);
        expect(assistants).toHaveLength(1);
        const call = assistants[0]!.tool_calls![0]!;

        // 模型原始调用标识被透传（不是运行时合成的）
        expect(call.id).toBe('call_real_1');
        expect(call.function.name).toBe('read_file');
        expect(JSON.parse(call.function.arguments)).toEqual({ path: 'src/a.ts' });

        // 工具结果通过同一标识与之配对
        const results = toolMessages(secondLoop!);
        expect(results).toHaveLength(1);
        expect(results[0]!.tool_call_id).toBe('call_real_1');
        expect(results[0]!.name).toBe('read_file');

        const payload = JSON.parse(results[0]!.content);
        expect(payload.success).toBe(true);
        expect(payload.data.path).toBe('src/a.ts');
    });

    it('重建的消息序列覆盖已记录的决策与观察', async () => {
        const provider = new CapturingProvider([
            { decision: { type: 'Action', tool: 'read_file', params: { path: 'src/a.ts' }, thought: '第一次' } },
            { decision: { type: 'Action', tool: 'read_file', params: { path: 'src/a.ts' }, thought: '第二次' } },
            { decision: { type: 'Final', answer: '完成' } },
        ]);

        const runtime = new AgentRuntime(provider, [new ReadFileTool()], {
            workspacePath: workspaceDir,
            maxIterations: 5,
        });
        const result = await runtime.run('读两次');

        expect(result.state.observations).toHaveLength(2);

        const last = provider.calls[provider.calls.length - 1]!;
        expect(toolMessages(last)).toHaveLength(2);
        expect(assistantWithCalls(last)).toHaveLength(2);

        // 声明里没有 toolCallId 时按位置合成，但仍然成对
        const ids = assistantWithCalls(last).map(a => a.tool_calls![0]!.id);
        expect(ids).toEqual(['call_0_0', 'call_1_0']);
        expect(toolMessages(last).map(m => m.tool_call_id)).toEqual(['call_0_0', 'call_1_0']);

        // 结果内容取自实际观察，而不是模型复述
        expect(JSON.parse(toolMessages(last)[0]!.content).data.content).toContain('export const a');
    });

    it('一次批量动作的多个调用各自成对', async () => {
        const provider = new CapturingProvider([
            {
                decision: {
                    type: 'BatchAction',
                    thought: '并发读取',
                    actions: [
                        { tool: 'read_file', params: { path: 'src/a.ts' }, toolCallId: 'call_x' },
                        { tool: 'read_file', params: { path: 'src/a.ts' }, toolCallId: 'call_y' },
                    ],
                },
            },
            { decision: { type: 'Final', answer: '完成' } },
        ]);

        const runtime = new AgentRuntime(provider, [new ReadFileTool()], {
            workspacePath: workspaceDir,
            maxIterations: 5,
        });
        await runtime.run('并发读取两次');

        const secondLoop = provider.calls[2]!;
        const call = assistantWithCalls(secondLoop)[0]!;
        expect(call.tool_calls!.map(c => c.id)).toEqual(['call_x', 'call_y']);
        expect(toolMessages(secondLoop).map(m => m.tool_call_id)).toEqual(['call_x', 'call_y']);
    });

    it('构造「有调用无结果」的历史时，序列中不残留该调用', () => {
        const messages: ChatMessage[] = [
            { role: 'system', content: '系统指令' },
            {
                role: 'assistant',
                content: null,
                tool_calls: [
                    { index: 0, id: 'call_ok', type: 'function', function: { name: 'read_file', arguments: '{}' } },
                    { index: 1, id: 'call_orphan', type: 'function', function: { name: 'read_file', arguments: '{}' } },
                ],
            },
            { role: 'tool', tool_call_id: 'call_ok', name: 'read_file', content: '{"success":true}' },
            { role: 'tool', tool_call_id: 'call_unmatched', name: 'read_file', content: '{}' },
        ];

        const cleaned = sanitizeMessageSequence(messages);

        const keptCallIds = assistantWithCalls(cleaned).flatMap(a => a.tool_calls!.map(c => c.id));
        expect(keptCallIds).toEqual(['call_ok']);
        expect(keptCallIds).not.toContain('call_orphan');

        // 无对应调用的工具结果也被丢弃
        expect(toolMessages(cleaned).map(m => m.tool_call_id)).toEqual(['call_ok']);
    });

    it('调用被全部清理时助手消息降级为纯文本，连续的助手文本被合并', () => {
        const messages: ChatMessage[] = [
            {
                role: 'assistant',
                content: null,
                tool_calls: [
                    { index: 0, id: 'call_dangling', type: 'function', function: { name: 'read_file', arguments: '{}' } },
                ],
            },
            { role: 'assistant', content: '上面这条调用没有任何结果' },
            { role: 'assistant', content: '两条纯文本应被合并' },
        ];

        const cleaned = sanitizeMessageSequence(messages);

        expect(cleaned).toHaveLength(1);
        expect(cleaned[0]!.role).toBe('assistant');
        expect(cleaned[0]!.content).toContain('没有任何结果');
        expect(cleaned[0]!.content).toContain('应被合并');
    });
});

describe('累计 token 用量', () => {
    let workspaceDir: string;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({ 'src/a.ts': 'export const a = 1;\n' });
    });

    afterEach(() => {
        cleanupTestWorkspace(workspaceDir);
    });

    it('累计消耗等于各轮用量之和', async () => {
        const provider = new CapturingProvider([
            {
                decision: { type: 'Action', tool: 'read_file', params: { path: 'src/a.ts' }, thought: '' },
                usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            },
            {
                decision: { type: 'Action', tool: 'read_file', params: { path: 'src/a.ts' }, thought: '' },
                usage: { promptTokens: 20, completionTokens: 7, totalTokens: 27 },
            },
            {
                decision: { type: 'Final', answer: '完成' },
                usage: { promptTokens: 30, completionTokens: 3, totalTokens: 33 },
            },
        ]);

        const runtime = new AgentRuntime(provider, [new ReadFileTool()], {
            workspacePath: workspaceDir,
            maxIterations: 5,
        });
        const { state } = await runtime.run('读两次');

        expect(state.tokenUsage.totalTokens).toBe(5 + 15 + 27 + 33);
        expect(state.tokenUsage.promptTokens).toBe(4 + 60);
        expect(state.tokenUsage.completionTokens).toBe(1 + 15);
        expect(state.tokenUsage.complete).toBe(true);
    });

    it('某轮缺失用量时标记为不完整，且该轮不计入累计值', async () => {
        const provider = new CapturingProvider([
            {
                decision: { type: 'Action', tool: 'read_file', params: { path: 'src/a.ts' }, thought: '' },
                usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            },
            {
                // 这一轮没有 usage
                decision: { type: 'Action', tool: 'read_file', params: { path: 'src/a.ts' }, thought: '' },
            },
            {
                decision: { type: 'Final', answer: '完成' },
                usage: { promptTokens: 30, completionTokens: 3, totalTokens: 33 },
            },
        ]);

        const runtime = new AgentRuntime(provider, [new ReadFileTool()], {
            workspacePath: workspaceDir,
            maxIterations: 5,
        });
        const { state } = await runtime.run('读两次');

        // 不补 0：缺失的那轮既不贡献数值，也不被当作 0 计
        expect(state.tokenUsage.totalTokens).toBe(5 + 15 + 33);
        expect(state.tokenUsage.complete).toBe(false);
    });
});
