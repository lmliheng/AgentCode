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

/** 不需要审批的工具，只记录「同时有几个在跑」，用来确认纯读批次没被牵连成串行 */
class ConcurrencyProbeTool implements Tool<ToolParams> {
    name = 'probe_tool';
    description = '不需要审批的并发探针';
    permissions = { readsFiles: false, writesFiles: false, runsShell: false, requiresApproval: false };
    private inFlight = 0;
    maxInFlight = 0;

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

    async execute(params: ToolParams): Promise<ToolResult> {
        this.inFlight += 1;
        this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        this.inFlight -= 1;
        return { success: true, data: { path: (params as { path: string }).path } };
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

    /**
     * 一次只允许一个审批在途。
     *
     * readline 的硬性语义是「上一问没回答就不接受第二问」——`[kQuestion]` 在已有
     * 待答问题时只重画当前提示、不注册回调，于是后到的那一问被静默丢弃，它的
     * promise 永不 settle，整批挂死且没有报错。这里把这个约束变成可断言的事实：
     * 一旦出现重叠提问，`overlap` 就会被填上。
     */
    function makeSerialApprover(answer: (path: string) => 'approve' | 'reject') {
        const askedPaths: string[] = [];
        const overlap: string[] = [];
        let inFlight = false;

        const approver = async (action: PendingAction): Promise<'approve' | 'reject'> => {
            const path = String(action.source.decision.params['path'] ?? '');
            if (inFlight) overlap.push(path);
            inFlight = true;
            askedPaths.push(path);
            // 让出若干微任务/宏任务，给「并发提问」留下暴露的机会
            await new Promise((resolve) => setTimeout(resolve, 5));
            inFlight = false;
            return answer(path);
        };

        return { approver, askedPaths, overlap };
    }

    it('一个批次里有多个需审批动作时，提问串行：一次一问、按声明顺序、各得独立回答', async () => {
        const tool = new GuardedTool();
        const { approver, askedPaths, overlap } = makeSerialApprover((path) =>
            path === 'src/a.ts' ? 'approve' : 'reject',
        );

        const runtime = new AgentRuntime(
            new ScriptedProvider([
                initialPlanDecision(),
                {
                    type: 'BatchAction',
                    thought: '两件都要审批',
                    actions: [
                        { tool: 'guarded_tool', params: { path: 'src/a.ts' }, thought: '第一件' },
                        { tool: 'guarded_tool', params: { path: 'src/b.ts' }, thought: '第二件' },
                    ],
                },
                { type: 'Final', answer: '完成' },
            ]),
            [tool],
            { workspacePath: workspaceDir, maxIterations: 5, requestApproval: approver },
        );

        const { state } = await runtime.run('做两件需要审批的事');

        // 没有两个问题同时在等答案 —— 这正是原来会挂死的地方
        expect(overlap).toEqual([]);
        // 一次一问，且顺序与模型声明的动作顺序一致
        expect(askedPaths).toEqual(['src/a.ts', 'src/b.ts']);

        // 回答与动作一一对应，没有被串到别的动作上
        expect(tool.executeCalls).toBe(1);
        expect(state.observations).toHaveLength(2);
        const rejected = state.observations.filter((observation) => !observation.result.success);
        expect(rejected).toHaveLength(1);
        expect(rejected[0]!.result.error).toContain('拒绝');
        const rejectedPath = String((rejected[0]!.action.params as Record<string, unknown>)['path']);
        expect(rejectedPath).toBe('src/b.ts');
    });

    it('需审批的工具经 tool_call 信封抵达时，同样降级为串行', async () => {
        const tool = new GuardedTool();
        const { approver, overlap } = makeSerialApprover(() => 'approve');

        const runtime = new AgentRuntime(
            new ScriptedProvider([
                initialPlanDecision(),
                {
                    type: 'BatchAction',
                    thought: '经信封调用两件需审批的事',
                    actions: [
                        {
                            tool: 'tool_call',
                            params: { name: 'guarded_tool', arguments: { path: 'src/a.ts' } },
                            thought: '第一件',
                        },
                        {
                            tool: 'tool_call',
                            params: { name: 'guarded_tool', arguments: { path: 'src/b.ts' } },
                            thought: '第二件',
                        },
                    ],
                },
                { type: 'Final', answer: '完成' },
            ]),
            [tool],
            { workspacePath: workspaceDir, maxIterations: 5, requestApproval: approver },
        );

        const { state } = await runtime.run('经信封做两件需要审批的事');

        // 只看 action.tool 的话这里会判成「无需审批」，两个问题就会同时发出
        expect(overlap).toEqual([]);
        expect(tool.executeCalls).toBe(2);
        expect(state.observations.every((observation) => observation.result.success)).toBe(true);
    });

    it('不含需审批动作的批次仍然并发执行', async () => {
        const tool = new ConcurrencyProbeTool();
        const approver = vi.fn(async () => 'approve' as const);

        const runtime = new AgentRuntime(
            new ScriptedProvider([
                initialPlanDecision(),
                {
                    type: 'BatchAction',
                    thought: '同时读两处',
                    actions: [
                        { tool: 'probe_tool', params: { path: 'src/a.ts' }, thought: '第一处' },
                        { tool: 'probe_tool', params: { path: 'src/b.ts' }, thought: '第二处' },
                    ],
                },
                { type: 'Final', answer: '完成' },
            ]),
            [tool],
            { workspacePath: workspaceDir, maxIterations: 5, requestApproval: approver },
        );

        await runtime.run('同时读两处');

        // 降级只针对含审批的批次，纯读批次不该被牵连成串行
        expect(tool.maxInFlight).toBeGreaterThan(1);
        expect(approver).not.toHaveBeenCalled();
    });

});
