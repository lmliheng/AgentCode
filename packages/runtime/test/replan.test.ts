// 决策回退：反复失败时回灌失败上下文，以及计划状态机的真实推进。
//
// 对应 run_test/PRD.md §6.2/§6.4/§7.1：
//   - 原来的「自动 replan」命中后只是把 stopReason 置成 error，整份 trace 里没有任何
//     Replan 决策，plan.version 一直是 1；
//   - 计划步骤从来没有被置为 completed（全仓库只有 filter 读取），于是每轮看到的计划
//     都是全套 ⏳，replan 时 `filter(completed)` 恒为空集，进展整体蒸发。

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentRuntime } from '../src/agent.runtime.js';
import { createTestWorkspace, cleanupTestWorkspace, initialPlanDecision } from './setup.js';
import type {
    AgentProvider,
    AgentProviderConfig,
    ChatMessage,
    ModelDecision,
    ModelResponse,
    PlanStep,
    Tool,
    ToolParams,
    ToolResult,
    ValidationResult,
} from '@lmliheng/acode-core';

class ScriptedProvider implements AgentProvider {
    readonly name = 'scripted';
    config: AgentProviderConfig = { modelName: 'scripted', temperature: 0, maxTokens: 100 };
    readonly calls: ChatMessage[][] = [];
    private index = 0;

    constructor(private readonly decisions: ModelDecision[]) {}

    updateConfig(): void {
        // 测试用
    }

    async decide(messages: ChatMessage[]): Promise<ModelResponse> {
        this.calls.push(messages.map((message) => ({ ...message })));
        const decision = this.decisions[this.index] ?? { type: 'Final' as const, answer: '结束' };
        this.index += 1;
        return { decision, rawContent: '' };
    }
}

class AlwaysFailingTool implements Tool<ToolParams> {
    name = 'flaky_tool';
    description = '总是失败的测试工具';
    permissions = { readsFiles: false, writesFiles: false, runsShell: false, requiresApproval: false };
    calls = 0;

    getSchema() {
        return { type: 'object', properties: { attempt: { type: 'string' } }, required: [] };
    }

    validate(params: unknown): ValidationResult {
        const p = (params ?? {}) as Record<string, unknown>;
        return { valid: true, errors: [], sanitized: { attempt: String(p.attempt ?? '') } as ToolParams };
    }

    async execute(): Promise<ToolResult> {
        this.calls += 1;
        return { success: false, data: null, error: `第 ${this.calls} 次尝试：连接超时` };
    }
}

function step(id: string, description: string, status: PlanStep['status'] = 'pending'): PlanStep {
    return { id, description, status, dependsOn: [], completionCriteria: '该步骤已完成' };
}

/** 把某条消息里的文本拼起来，便于断言「模型看到了什么」 */
function textOf(messages: ChatMessage[]): string {
    return messages
        .map((message) => (typeof message.content === 'string' ? message.content : ''))
        .join('\n');
}

describe('决策回退与计划推进', () => {
    let workspaceDir: string;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({ 'src/a.ts': 'export const a = 1;\n' });
    });

    afterEach(() => {
        cleanupTestWorkspace(workspaceDir);
    });

    function runtimeWith(decisions: ModelDecision[], tool: Tool<ToolParams>) {
        const provider = new ScriptedProvider([initialPlanDecision(), ...decisions]);
        const runtime = new AgentRuntime(provider, [tool], {
            workspacePath: workspaceDir,
            maxIterations: 12,
        } as never);
        return { runtime, provider };
    }

    it('反复失败先把失败上下文回灌给模型一次（不再是直接报错收摊）', async () => {
        const tool = new AlwaysFailingTool();
        const fail = (n: number): ModelDecision => ({
            type: 'Action',
            tool: 'flaky_tool',
            params: { attempt: String(n) },
            thought: '再试一次',
        });

        const { runtime, provider } = runtimeWith(
            [fail(1), fail(2), fail(3), { type: 'Final', answer: '放弃这条路线' }],
            tool,
        );

        const { state } = await runtime.run('把这件事做成');

        // 第三次失败之后的那一轮请求里，模型拿到了失败上下文与「重新规划」的要求
        const nudged = provider.calls[provider.calls.length - 1]!;
        expect(textOf(nudged)).toContain('重新规划');
        expect(textOf(nudged)).toContain('连接超时');

        // 没有停机：模型自己收的尾
        expect(state.stopReason?.type).toBe('task_completed');
        expect(tool.calls).toBe(3);
    });

    it('模型借这次机会提交 Replan：计划版本推进，已了结的步骤被保留', async () => {
        const tool = new AlwaysFailingTool();
        const fail = (n: number): ModelDecision => ({
            type: 'Action',
            tool: 'flaky_tool',
            params: { attempt: String(n) },
            thought: '再试一次',
        });

        const { runtime } = runtimeWith(
            [
                fail(1),
                fail(2),
                fail(3),
                {
                    type: 'Replan',
                    reason: '工具连不上，改走另一条路',
                    newPlan: [step('new-1', '换用本地数据'), step('new-2', '复核结果')],
                },
                { type: 'Final', answer: '完成' },
            ],
            tool,
        );

        const { state } = await runtime.run('把这件事做成');

        expect(state.plan.version).toBe(2);
        // 旧计划里的步骤作为历史保留下来（失败的那一步标 ❌），而不是被整体丢弃
        expect(state.plan.steps.some((s) => s.status === 'failed')).toBe(true);
        // 新步骤进来了
        expect(state.plan.steps.some((s) => s.description === '换用本地数据')).toBe(true);
        // 当前步骤指向新的第一个未完成步骤，而不是回到 0
        const current = state.plan.steps[state.plan.currentStepIndex]!;
        expect(current.status).toBe('pending');
        expect(current.description).toBe('换用本地数据');
    });

    it('模型可以自己把步骤标成 completed，下一次请求里就能看到 ✅（原来没有任何写入方）', async () => {
        const tool = new AlwaysFailingTool();
        const { runtime, provider } = runtimeWith(
            [
                {
                    type: 'Replan',
                    reason: '第一步已经完成，推进计划',
                    newPlan: [
                        step('s1', '理解任务', 'completed'),
                        step('s2', '动手实现'),
                    ],
                },
                { type: 'Final', answer: '完成' },
            ],
            tool,
        );

        const { state } = await runtime.run('做点事');

        expect(state.plan.version).toBe(2);
        const kept = state.plan.steps.find((s) => s.description === '理解任务')!;
        expect(kept.status).toBe('completed');
        // 当前步骤落在未完成的那一步上
        expect(state.plan.steps[state.plan.currentStepIndex]!.description).toBe('动手实现');

        // 渲染进下一轮请求的计划里带上了完成标记
        const last = provider.calls[provider.calls.length - 1]!;
        expect(textOf(last)).toContain('✅');
    });

    it('回灌一次仍失败就停机，并说清是「重新规划之后还是不行」', async () => {
        const tool = new AlwaysFailingTool();
        const fail = (n: number): ModelDecision => ({
            type: 'Action',
            tool: 'flaky_tool',
            params: { attempt: String(n) },
            thought: '还是这条路',
        });

        const { runtime } = runtimeWith(
            [fail(1), fail(2), fail(3), fail(4), fail(5), fail(6), fail(7)],
            tool,
        );

        const { state } = await runtime.run('把这件事做成');

        expect(state.stopReason?.type).toBe('error');
        expect(JSON.stringify(state.stopReason)).toContain('反复失败');
        // 第一次回灌之后又失败 3 次才停 —— 不是一撞上就直接放弃
        expect(tool.calls).toBe(6);
    });

    it('模型提交 Replan 后重新获得失败预算（换路线不该被旧账拖累）', async () => {
        const tool = new AlwaysFailingTool();
        const fail = (n: number): ModelDecision => ({
            type: 'Action',
            tool: 'flaky_tool',
            params: { attempt: String(n) },
            thought: '再试',
        });

        const { runtime } = runtimeWith(
            [
                fail(1),
                fail(2),
                fail(3),
                { type: 'Replan', reason: '换路线', newPlan: [step('n1', '换做法')] },
                fail(4),
                fail(5),
                fail(6),
                { type: 'Final', answer: '完成' },
            ],
            tool,
        );

        const { state } = await runtime.run('把这件事做成');

        expect(state.plan.version).toBe(2);
        // 第二次的三连失败之后仍然只是回灌（模型随后给 Final），没有直接 error
        expect(state.stopReason?.type).toBe('task_completed');
        expect(tool.calls).toBe(6);
    });
});
