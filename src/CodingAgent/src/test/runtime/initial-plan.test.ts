// src/test/runtime/initial-plan.test.ts
//
// 覆盖初始计划（AgentRuntime.createInitialPlan）：
//   - 计划由模型提交，而不是运行时写死
//   - 提交的步骤被规范到 PlanStep 的类型约束（id 唯一、依赖闭合、状态为 pending）
//   - 规划轮不消耗迭代与工具调用预算，但用量计入累计消耗
//   - 拿不到计划时回落到兜底计划，不把整个任务拦在规划阶段
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentRuntime } from '../../runtime/agent.runtime.js';
import { ReadFileTool } from '../../tools/read_file.js';
import { createTestWorkspace, cleanupTestWorkspace } from '../setup.js';
import type {
    AgentProvider,
    AgentProviderConfig,
    ModelResponse,
    TokenUsage,
    ToolDefinition,
} from '../../types/AgentProvider.js';
import type { ChatMessage } from '../../types/Message.js';
import type { ModelDecision, PlanStep } from '../../types/ReAct.js';
import type { SessionEventInput } from '../../persistence/events.js';

type ScriptEntry =
    | { decision: ModelDecision; usage?: TokenUsage }
    | { throw: string };

/** 一个类型完整的单步计划 */
function singleStep(description: string): PlanStep {
    return {
        id: 'step-1',
        description,
        status: 'pending',
        dependsOn: [],
        completionCriteria: '该步骤已完成',
    };
}

/** 按脚本逐轮返回决策，并记录每次请求的消息与工具声明 */
class ScriptedProvider implements AgentProvider {
    readonly name = 'scripted';
    config: AgentProviderConfig = { modelName: 'scripted', temperature: 0, maxTokens: 100 };
    readonly calls: Array<{ messages: ChatMessage[]; tools: ToolDefinition[] }> = [];
    private index = 0;

    constructor(private readonly script: ScriptEntry[]) {}

    updateConfig(): void {
        // 测试用，无需实现
    }

    async decide(messages: ChatMessage[], tools: ToolDefinition[] = []): Promise<ModelResponse> {
        this.calls.push({ messages, tools });

        const entry = this.script[this.index];
        this.index += 1;

        if (entry && 'throw' in entry) {
            throw new Error(entry.throw);
        }

        const decision: ModelDecision = entry?.decision ?? { type: 'Final', answer: '结束' };
        return {
            decision,
            rawContent: '',
            ...(entry && entry.usage ? { usage: entry.usage } : {}),
        };
    }
}

/** 记录执行的测试工具 */
function recordingTool(executed: string[]) {
    const tool = {
        name: 'record_tool',
        description: '记录被执行的测试工具',
        permissions: { readsFiles: false, writesFiles: false, runsShell: false, requiresApproval: false },
        getSchema: () => ({ type: 'object', properties: {}, required: [] }),
        validate: () => ({ valid: true, errors: [], sanitized: {} }),
        async execute() {
            executed.push(tool.name);
            return { success: true, data: { ok: true }, error: '' };
        },
    };
    return tool;
}

/** 计划里出现过的描述，用于确认模型确实看到了计划 */
function userText(call: { messages: ChatMessage[] }): string {
    return call.messages
        .filter(message => message.role === 'user')
        .map(message => message.content ?? '')
        .join('\n');
}

describe('初始计划', () => {
    let workspaceDir: string;
    let executed: string[];

    beforeEach(() => {
        workspaceDir = createTestWorkspace({ 'src/a.ts': 'export const a = 1;\n' });
        executed = [];
    });

    afterEach(() => {
        cleanupTestWorkspace(workspaceDir);
    });

    function runtimeFor(provider: AgentProvider): AgentRuntime {
        return new AgentRuntime(provider, [recordingTool(executed)], {
            workspacePath: workspaceDir,
            maxIterations: 5,
        });
    }

    it('模型提交的步骤成为运行计划，并被规范到类型约束', async () => {
        const provider = new ScriptedProvider([
            {
                decision: {
                    type: 'Replan',
                    reason: '初始规划',
                    newPlan: [
                        {
                            id: 'a',
                            description: '  先理解现有代码  ',
                            // 模型自报已完成不可采信
                            status: 'completed',
                            dependsOn: ['b'],
                            completionCriteria: '已确认改动点',
                        },
                        // 自引用、重复项、悬空引用都要被丢弃
                        { id: 'b', description: '实现变更', status: 'pending', dependsOn: ['a', 'a', 'b', '不存在的 id'], completionCriteria: '变更已完成' },
                        // 重复 id：依赖指向先出现的那个
                        { id: 'a', description: '重复 id 的步骤', status: 'pending', dependsOn: ['a'], completionCriteria: '不适用' },
                        // 没有描述的步骤无法推进，直接丢弃
                        { id: 'c', description: '   ', status: 'pending', dependsOn: [], completionCriteria: '不适用' },
                        { id: 'd', description: '运行测试验证', status: 'pending', dependsOn: ['b'], completionCriteria: '测试通过' },
                    ],
                },
                usage: { promptTokens: 11, completionTokens: 3, totalTokens: 14 },
            },
            {
                decision: { type: 'Final', answer: '完成' },
                usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
            },
        ]);

        const { state } = await runtimeFor(provider).run('给 a.ts 加个函数');

        const steps = state.plan.steps;

        // 空描述的步骤被丢弃，其余按位置重编出唯一 id
        expect(steps.map(step => step.id)).toEqual(['step-1', 'step-2', 'step-3', 'step-4']);
        expect(steps[0]!.description).toBe('先理解现有代码');
        expect(steps.every(step => step.status === 'pending')).toBe(true);

        // 依赖落到重编后的 id 上：自引用、重复、悬空引用都没有留下来
        expect(steps[0]!.dependsOn).toEqual(['step-2']);
        expect(steps[1]!.dependsOn).toEqual(['step-1']);
        expect(steps[2]!.dependsOn).toEqual(['step-1']);
        expect(steps[3]!.dependsOn).toEqual(['step-2']);

        // 缺失的完成判据落成空串，而不是 undefined
        expect(steps[0]!.completionCriteria).toBe('已确认改动点');
        expect(steps[3]!.completionCriteria).toBe('测试通过');

        // 初始计划是 v1，不是一次 replan
        expect(state.plan.version).toBe(1);
    });

    it('规划轮下发工具声明并要求模型用 request_replan 提交', async () => {
        const provider = new ScriptedProvider([
            { decision: { type: 'Replan', reason: '初始规划', newPlan: [singleStep('做一件事')] } },
            { decision: { type: 'Final', answer: '完成' } },
        ]);

        await runtimeFor(provider).run('做一件事');

        const planCall = provider.calls[0]!;

        // 控制流入口只在有可执行工具时才会被声明，这是拿到计划的前提
        expect(planCall.tools.map(tool => tool.name)).toEqual(['record_tool']);
        expect(userText(planCall)).toContain('request_replan');
        expect(userText(planCall)).toContain('做一件事');
    });

    it('规划轮不消耗迭代与工具调用预算，但用量计入累计消耗', async () => {
        const provider = new ScriptedProvider([
            {
                decision: { type: 'Replan', reason: '初始规划', newPlan: [singleStep('做一件事')] },
                usage: { promptTokens: 11, completionTokens: 3, totalTokens: 14 },
            },
            {
                decision: { type: 'Final', answer: '完成' },
                usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
            },
        ]);

        const { state } = await runtimeFor(provider).run('做一件事');

        // 规划是独立的一轮调用，不计入 ReAct 循环的计数
        expect(state.iterationCount).toBe(1);
        expect(state.toolCallCount).toBe(0);
        // 但它确实消耗了 token
        expect(state.tokenUsage.totalTokens).toBe(14 + 6);
        // 计划不在决策历史里：策略入口不占用「决策 → 观察」的配对关系
        expect(state.decisions).toHaveLength(1);
        expect(state.observations).toHaveLength(0);
    });

    it('生成的计划出现在循环首轮的上下文里', async () => {
        const provider = new ScriptedProvider([
            {
                decision: {
                    type: 'Replan',
                    reason: '初始规划',
                    newPlan: [singleStep('只属于这次任务的步骤')],
                },
            },
            { decision: { type: 'Final', answer: '完成' } },
        ]);

        await runtimeFor(provider).run('做一件事');

        // calls[1] 是进入循环后的第一次请求
        expect(userText(provider.calls[1]!)).toContain('只属于这次任务的步骤');
    });

    it('模型没提交计划时使用兜底计划，且循环照常继续', async () => {
        const provider = new ScriptedProvider([
            // 规划轮拿回来的是可执行动作：不符合协议，不能当成计划，也不被执行
            { decision: { type: 'Action', tool: 'record_tool', params: {}, thought: '直接开工' } },
            { decision: { type: 'Action', tool: 'record_tool', params: {}, thought: '正式开工' } },
            { decision: { type: 'Final', answer: '完成' } },
        ]);

        const { state } = await runtimeFor(provider).run('做一件事');

        // 兜底计划原样可用：步骤齐全、依赖闭合、全部待执行
        expect(state.plan.steps.map(step => step.id)).toEqual(['step-1', 'step-2', 'step-3']);
        expect(state.plan.steps.every(step => step.status === 'pending')).toBe(true);
        expect(state.plan.steps[1]!.dependsOn).toEqual(['step-1']);

        // 被丢弃的规划轮响应没有变成观察
        expect(state.observations).toHaveLength(1);
        expect(executed).toHaveLength(1);
        expect(state.stopReason?.type).toBe('task_completed');
    });

    it('规划轮的模型调用失败时回落到兜底计划，不把运行判为错误', async () => {
        const provider = new ScriptedProvider([
            { throw: '模拟网络失败' },
            { decision: { type: 'Action', tool: 'record_tool', params: {}, thought: '开工' } },
            { decision: { type: 'Final', answer: '完成' } },
        ]);

        const { state } = await runtimeFor(provider).run('做一件事');

        expect(state.stopReason?.type).toBe('task_completed');
        expect(state.plan.steps).toHaveLength(3);
        expect(executed).toHaveLength(1);
    });

    it('计划数组里没有可用步骤时回落到兜底计划', async () => {
        const provider = new ScriptedProvider([
            {
                decision: {
                    type: 'Replan',
                    reason: '初始规划',
                    newPlan: [
                        // 只有空白描述
                        { id: 'a', description: '   ', status: 'pending', dependsOn: [], completionCriteria: '' },
                        // 残缺项：Provider 边界之外仍可能送来这种载荷，运行时必须自己挡住
                        { id: 'b' } as unknown as PlanStep,
                    ],
                },
            },
            { decision: { type: 'Final', answer: '完成' } },
        ]);

        const { state } = await runtimeFor(provider).run('做一件事');

        expect(state.plan.steps).toHaveLength(3);
        expect(state.plan.steps[0]!.description).toContain('理解需求');
    });

    it('没有注册任何工具时不发起规划轮', async () => {
        const provider = new ScriptedProvider([{ decision: { type: 'Final', answer: '结束' } }]);

        const events: SessionEventInput[] = [];
        const runtime = new AgentRuntime(provider, [], {
            workspacePath: workspaceDir,
            maxIterations: 5,
            onSessionEvent: (event: SessionEventInput) => events.push(event),
        });
        const { state } = await runtime.run('做一件事');

        // 没有工具就不会声明控制流入口，规划轮注定拿不到计划，因此不做这次调用
        expect(provider.calls).toHaveLength(1);
        expect(state.plan.steps).toHaveLength(3);

        // 跳过这一次调用不等于跳过落账：重放会话靠事件流重建计划，
        // 只把 steps 设进内存的话，恢复出来的会话会是个没有计划的会话
        const planEvent = events.find((event) => event.type === 'plan_updated');
        expect((planEvent?.payload as { plan: { steps: PlanStep[] } }).plan.steps).toHaveLength(3);
    });

    it('兜底计划不跨运行共享', async () => {
        const provider = new ScriptedProvider([
            { decision: { type: 'Final', answer: '完成' } },
            { decision: { type: 'Final', answer: '完成' } },
        ]);

        const runtime = runtimeFor(provider);
        const first = await runtime.run('第一次');
        first.state.plan.steps[0]!.status = 'completed';

        const second = await runtime.run('第二次');

        expect(second.state.plan.steps[0]!.status).toBe('pending');
    });
});
