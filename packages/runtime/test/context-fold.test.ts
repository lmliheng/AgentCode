// 上下文折叠的运行时行为：判据本身在 core 单测里，这里钉住的是「怎么用在消息序列上」。
//
// 两条底线：
//   1. 折叠只改内容、不改结构 —— 工具调用与结果必须仍然逐条配对（序列非法会让请求直接失败）；
//   2. 没超预算就一个字都不该动（白折的代价是模型被迫重读，比省下的 token 更贵）。

import { afterEach, describe, expect, it } from 'vitest';
import { AgentRuntime } from '../src/agent.runtime.js';
import { createTestWorkspace, cleanupTestWorkspace, initialPlanDecision } from './setup.js';
import type {
    AgentProvider,
    AgentProviderConfig,
    ChatMessage,
    ModelDecision,
    ModelResponse,
    Tool,
    ToolParams,
    ToolResult,
    ValidationResult,
} from '@lmliheng/acode-core';

/** 记下每次请求的消息 */
class RecordingProvider implements AgentProvider {
    readonly name = 'recording';
    config: AgentProviderConfig = { modelName: 'recording', temperature: 0, maxTokens: 100 };
    readonly requests: ChatMessage[][] = [];
    private index = 0;

    constructor(private readonly decisions: ModelDecision[]) {}

    updateConfig(): void {
        // 测试用
    }

    async decide(messages: ChatMessage[]): Promise<ModelResponse> {
        this.requests.push([...messages]);
        const decision = this.decisions[this.index] ?? { type: 'Final' as const, answer: '结束' };
        this.index += 1;
        return { decision, rawContent: '' };
    }
}

/** 每步产出一段固定长度的输出，用来把上下文迅速撑大 */
class LoudTool implements Tool<ToolParams> {
    name = 'loud_tool';
    description = '产出很长输出的测试工具';
    permissions = { readsFiles: false, writesFiles: false, runsShell: false, requiresApproval: false };

    constructor(private readonly payload: string) {}

    getSchema() {
        return { type: 'object', properties: { n: { type: 'number' } }, required: [] };
    }

    validate(params: unknown): ValidationResult {
        const p = (params ?? {}) as Record<string, unknown>;
        return { valid: true, errors: [], sanitized: { n: Number(p.n ?? 0) } as ToolParams };
    }

    async execute(params: ToolParams): Promise<ToolResult> {
        return { success: true, data: `第 ${(params as { n: number }).n} 步：${this.payload}` };
    }
}

const LONG_PAYLOAD = 'A'.repeat(4000);

describe('上下文折叠', () => {
    const workspaces: string[] = [];

    afterEach(() => {
        while (workspaces.length > 0) {
            cleanupTestWorkspace(workspaces.pop()!);
        }
    });

    function steps(count: number): ModelDecision[] {
        return Array.from({ length: count }, (_, i) => ({
            type: 'Action' as const,
            tool: 'loud_tool',
            params: { n: i + 1 },
            thought: `第 ${i + 1} 步`,
        }));
    }

    function runtimeWith(
        decisions: ModelDecision[],
        config: Record<string, unknown>,
        events: string[] = [],
    ): AgentRuntime {
        const workspaceDir = createTestWorkspace({ 'src/a.ts': 'export const a = 1;\n' });
        workspaces.push(workspaceDir);
        return new AgentRuntime(
            new RecordingProvider(decisions),
            [new LoudTool(LONG_PAYLOAD)],
            {
                workspacePath: workspaceDir,
                maxIterations: 30,
                onSessionEvent: (event: { type: string }) => { events.push(event.type); },
                ...config,
            } as never,
        );
    }

    it('没超预算时不折：工具结果原样送进去', async () => {
        const provider = new RecordingProvider([initialPlanDecision(), ...steps(4), { type: 'Final', answer: '完成' }]);
        const workspaceDir = createTestWorkspace({ 'src/a.ts': 'export const a = 1;\n' });
        workspaces.push(workspaceDir);

        await new AgentRuntime(provider, [new LoudTool(LONG_PAYLOAD)], {
            workspacePath: workspaceDir,
            maxIterations: 30,
            // 预算给得很大：这组用例只关心「不折」这一侧
            contextTokenBudget: 10_000_000,
        } as never).run('跑几步');

        const toolMessages = provider.requests[provider.requests.length - 1]!
            .filter(message => message.role === 'tool');
        expect(toolMessages.length).toBe(4);
        expect(toolMessages.every(message => !message.content.startsWith('[历史已折叠]'))).toBe(true);
        expect(toolMessages[0]!.content).toContain(LONG_PAYLOAD);
    });

    it('超预算后较早的观察变成摘要，最近的仍是原文', async () => {
        const events: string[] = [];
        const provider = new RecordingProvider([initialPlanDecision(), ...steps(10), { type: 'Final', answer: '完成' }]);
        const workspaceDir = createTestWorkspace({ 'src/a.ts': 'export const a = 1;\n' });
        workspaces.push(workspaceDir);
        const runtime = new AgentRuntime(provider, [new LoudTool(LONG_PAYLOAD)], {
            workspacePath: workspaceDir,
            maxIterations: 30,
            // 每步 4000 字符（≈1000 token），预算压到 2000：三、四步之后必然超
            contextTokenBudget: 2000,
            onSessionEvent: (event: { type: string }) => { events.push(event.type); },
        } as never);

        await runtime.run('一直做下去');

        const last = provider.requests[provider.requests.length - 1]!;
        const toolMessages = last.filter(message => message.role === 'tool');
        expect(toolMessages.length).toBe(10);

        const folded = toolMessages.filter(message => message.content.startsWith('[历史已折叠]'));
        expect(folded.length).toBeGreaterThan(0);
        // 最近的观察必须还是原文：模型正靠它做事
        expect(toolMessages[toolMessages.length - 1]!.content).toContain(LONG_PAYLOAD);
        // 摘要要显著短于原文
        expect(folded[0]!.content.length).toBeLessThan(2000);

        // 折叠必须留痕：事件流里要能查到「从这一轮起历史被折了」
        expect(events).toContain('context_folded');
    });

    it('折叠不破坏工具调用与结果的配对', async () => {
        const provider = new RecordingProvider([initialPlanDecision(), ...steps(10), { type: 'Final', answer: '完成' }]);
        const workspaceDir = createTestWorkspace({ 'src/a.ts': 'export const a = 1;\n' });
        workspaces.push(workspaceDir);

        await new AgentRuntime(provider, [new LoudTool(LONG_PAYLOAD)], {
            workspacePath: workspaceDir,
            maxIterations: 30,
            contextTokenBudget: 2000,
        } as never).run('一直做下去');

        const last = provider.requests[provider.requests.length - 1]!;

        // 每个带工具调用的助手消息，后面都要跟着同 id 的结果消息（顺序与数量都对齐）
        const callIds: string[] = [];
        for (const [index, message] of last.entries()) {
            if (message.role !== 'assistant' || !message.tool_calls) continue;
            for (const call of message.tool_calls) {
                callIds.push(call.id);
                const next = last[index + 1];
                expect(next?.role).toBe('tool');
                expect((next as { tool_call_id: string }).tool_call_id).toBe(call.id);
            }
        }
        expect(callIds.length).toBe(10);
    });

    it('历史 run 超出预算时整段折成一行摘要', async () => {
        const provider = new RecordingProvider([initialPlanDecision(), { type: 'Final', answer: '完成' }]);
        const workspaceDir = createTestWorkspace({ 'src/a.ts': 'export const a = 1;\n' });
        workspaces.push(workspaceDir);

        const priorRun = {
            taskDescription: `上一轮的长任务${'x'.repeat(6000)}`,
            plan: { originalGoal: '上一轮', steps: [], currentStepIndex: 0, version: 1 },
            decisions: [{ type: 'Action' as const, tool: 'loud_tool', params: { n: 1 }, thought: '做' }],
            observations: [{
                action: { type: 'Action' as const, tool: 'loud_tool', params: { n: 1 } },
                result: { success: true, data: LONG_PAYLOAD },
                timestamp: 0,
            }],
        };

        await new AgentRuntime(provider, [new LoudTool(LONG_PAYLOAD)], {
            workspacePath: workspaceDir,
            maxIterations: 30,
            contextTokenBudget: 1000,
            priorRuns: [priorRun, priorRun],
        } as never).run('接着聊');

        // 首轮请求是「只做规划」的那一次，它不带历史（见 runPlanning）；
        // 带历史的是之后的那次，取最后一次请求来看。
        const last = provider.requests[provider.requests.length - 1]!;
        const foldedRuns = last.filter(
            message => message.role === 'user' && message.content.includes('这段历史已折叠'),
        );
        // 两条历史 run：只留最近那一条原样，更早的折成摘要
        expect(foldedRuns.length).toBe(1);
        expect(foldedRuns[0]!.content).toContain('重新读取文件');
        // 折叠只发生在历史这一层：本轮目标照常送达，且系统提示仍在最前
        expect(last.some(message => (message.content ?? '').includes('任务目标: 接着聊'))).toBe(true);
        expect(last[0]!.role).toBe('system');
    });
});
