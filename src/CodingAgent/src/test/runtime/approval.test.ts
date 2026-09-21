// src/test/runtime/approval.test.ts
//
// 覆盖 human-approval spec：
//   - 声明需要审批的工具必须先获得人工决定
//   - 审批请求携带可判读的操作预览
//   - 审批请求必须送达交互层
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentRuntime } from '../../runtime/agent.runtime.js';
import { ReadFileTool } from '../../tools/read_file.js';
import { createTestWorkspace, cleanupTestWorkspace, initialPlanDecision } from '../setup.js';
import type { Tool, ToolParams, ToolContext, ToolResult, ValidationResult, PendingAction } from '../../types/Tool.js';
import type { AgentProvider, AgentProviderConfig, ModelResponse } from '../../types/AgentProvider.js';
import type { ChatMessage } from '../../types/Message.js';
import type { ModelDecision } from '../../types/ReAct.js';

class ScriptedProvider implements AgentProvider {
    readonly name = 'scripted';
    config: AgentProviderConfig = { modelName: 'scripted', temperature: 0, maxTokens: 100 };
    private index = 0;

    constructor(private readonly decisions: ModelDecision[]) {}

    updateConfig(): void {
        // 测试用，无需实现
    }

    async decide(_messages: ChatMessage[]): Promise<ModelResponse> {
        const decision = this.decisions[this.index] ?? { type: 'Final' as const, answer: '结束' };
        this.index += 1;
        return { decision, rawContent: '' };
    }
}

/** 需要审批、且自身也会申请一次审批的工具（用于验证不会重复打扰） */
class GuardedTool implements Tool<ToolParams> {
    name = 'guarded_tool';
    description = '需要审批的测试工具';
    permissions = { readsFiles: false, writesFiles: true, runsShell: false, requiresApproval: true };
    executeCalls = 0;
    approvalsSeenByTool: string[] = [];

    getSchema() {
        return { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] };
    }

    validate(params: unknown): ValidationResult {
        const p = (params ?? {}) as Record<string, unknown>;
        if (typeof p.path !== 'string' || !p.path) {
            return { valid: false, errors: ['path 是必填字段'], sanitized: {} as ToolParams };
        }
        return { valid: true, errors: [], sanitized: { path: p.path } as ToolParams };
    }

    async execute(params: ToolParams, ctx: ToolContext): Promise<ToolResult> {
        // 工具内部再申请一次 —— 运行时不应因此重复询问人工
        const approval = await ctx.requestApproval(this.buildPending(ctx));
        this.approvalsSeenByTool.push(approval);
        if (approval !== 'approve') {
            return { success: false, data: null, error: '用户取消了操作' };
        }
        this.executeCalls += 1;
        return { success: true, data: { path: (params as any).path } };
    }

    private buildPending(ctx: ToolContext): PendingAction {
        return {
            id: `${ctx.runId}-guarded`,
            runId: ctx.runId,
            createdAt: Date.now(),
            source: {
                thought: '工具内部申请',
                decision: { type: 'Action', tool: this.name, params: {} },
                contextSnapshot: { currentPlan: '', recentHistory: '', currentStep: '' },
            },
            preview: {
                tool: this.name,
                summary: '工具内部的审批请求',
                affectedFiles: [],
                riskLevel: 'medium',
            },
            status: 'pending',
            expiresAt: Date.now() + 60_000,
        };
    }
}

describe('人工审批', () => {
    let workspaceDir: string;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({ 'src/a.ts': 'export const a = 1;\n' });
    });

    afterEach(() => {
        cleanupTestWorkspace(workspaceDir);
    });

    function runtimeWith(
        workspaceDir: string,
        tool: Tool<ToolParams>,
        requestApproval: (action: PendingAction) => Promise<'approve' | 'reject'>,
    ): AgentRuntime {
        return new AgentRuntime(
            new ScriptedProvider([
                // 脚本第一位留给规划轮，审批相关的决策从进入循环后开始
                initialPlanDecision(),
                { type: 'Action', tool: tool.name, params: { path: 'src/a.ts' }, thought: '动手' },
                { type: 'Final', answer: '完成' },
            ]),
            [tool],
            { workspacePath: workspaceDir, maxIterations: 5, requestApproval },
        );
    }

    it('审批拒绝后工具未被调用，并产生含拒绝原因的失败观察', async () => {
        const tool = new GuardedTool();
        const runtime = runtimeWith(workspaceDir, tool, async () => 'reject');

        const { state } = await runtime.run('做点需要审批的事');

        // 副作用没有发生
        expect(tool.executeCalls).toBe(0);
        // 模型收到可读的失败观察，循环得以继续
        expect(state.observations).toHaveLength(1);
        expect(state.observations[0]!.result.success).toBe(false);
        expect(state.observations[0]!.result.error).toContain('拒绝');
    });

    it('审批通过后工具被实际执行', async () => {
        const tool = new GuardedTool();
        const runtime = runtimeWith(workspaceDir, tool, async () => 'approve');

        const { state } = await runtime.run('做点需要审批的事');

        expect(tool.executeCalls).toBe(1);
        expect(state.observations[0]!.result.success).toBe(true);
    });

    it('同一动作内只问一次，运行时与工具不会各问一遍', async () => {
        const tool = new GuardedTool();
        const approver = vi.fn(async () => 'approve' as const);
        const runtime = runtimeWith(workspaceDir, tool, approver);

        await runtime.run('做点需要审批的事');

        // 运行时用富预览问一次；工具内部的再次申请复用该决定
        expect(approver).toHaveBeenCalledTimes(1);
        expect(tool.approvalsSeenByTool).toEqual(['approve']);
    });

    it('审批请求携带工具名、摘要、受影响文件与风险等级', async () => {
        const tool = new GuardedTool();
        const seen: PendingAction[] = [];
        const runtime = runtimeWith(workspaceDir, tool, async (action) => {
            seen.push(action);
            return 'approve';
        });

        await runtime.run('做点需要审批的事');

        expect(seen).toHaveLength(1);
        const preview = seen[0]!.preview;
        expect(preview.tool).toBe('guarded_tool');
        expect(preview.summary.length).toBeGreaterThan(0);
        expect(Array.isArray(preview.affectedFiles)).toBe(true);
        expect(['low', 'medium', 'high']).toContain(preview.riskLevel);
    });

    it('未标记需要审批的工具不触发审批', async () => {
        const approver = vi.fn(async () => 'approve' as const);
        const runtime = new AgentRuntime(
            new ScriptedProvider([
                initialPlanDecision(),
                { type: 'Action', tool: 'read_file', params: { path: 'src/a.ts' }, thought: '读取' },
                { type: 'Final', answer: '完成' },
            ]),
            [new ReadFileTool()],
            { workspacePath: workspaceDir, maxIterations: 5, requestApproval: approver },
        );

        const { state } = await runtime.run('读取文件');

        expect(approver).not.toHaveBeenCalled();
        expect(state.observations[0]!.result.success).toBe(true);
    });
});
