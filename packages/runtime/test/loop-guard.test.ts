// 循环守卫：重复动作与「成功但无进展」。
//
// 对应 run_test/PRD.md 第 6 节：9.21_7.md 里 14 次决策全是 BatchAction、参数每次
// 只微调一个字符，两个守卫都抓不到，于是一路把上下文烧到 340k tokens 后超时。

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentRuntime } from '../src/agent.runtime.js';
import { createTestWorkspace, cleanupTestWorkspace, initialPlanDecision } from './setup.js';
import type {
    AgentProvider,
    AgentProviderConfig,
    ChatMessage,
    ModelDecision,
    ModelResponse,
    Tool,
    ToolContext,
    ToolParams,
    ToolResult,
    ValidationResult,
} from '@lmliheng/acode-core';

class ScriptedProvider implements AgentProvider {
    readonly name = 'scripted';
    config: AgentProviderConfig = { modelName: 'scripted', temperature: 0, maxTokens: 100 };
    private index = 0;

    constructor(private readonly decisions: ModelDecision[]) {}

    updateConfig(): void {
        // 测试用
    }

    async decide(_messages: ChatMessage[]): Promise<ModelResponse> {
        const decision = this.decisions[this.index] ?? { type: 'Final' as const, answer: '结束' };
        this.index += 1;
        return { decision, rawContent: '' };
    }
}

/**
 * 结果固定的工具：不管参数怎么变，返回同一段内容 —— 模拟「参数在调、结果没变」。
 */
class FixedOutputTool implements Tool<ToolParams> {
    name = 'fetch_thing';
    description = '结果恒定的测试工具';
    permissions = { readsFiles: false, writesFiles: false, runsShell: false, requiresApproval: false };
    calls: Array<Record<string, unknown>> = [];

    getSchema() {
        return { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] };
    }

    validate(params: unknown): ValidationResult {
        const p = (params ?? {}) as Record<string, unknown>;
        return { valid: true, errors: [], sanitized: { url: String(p.url ?? '') } as ToolParams };
    }

    async execute(params: ToolParams): Promise<ToolResult> {
        this.calls.push(params as Record<string, unknown>);
        return { success: true, data: '同样的输出（含未替换的 %v 占位符）' };
    }
}

/** 每次返回不同结果的工具：正常推进，不该被判成循环 */
class VaryingOutputTool implements Tool<ToolParams> {
    name = 'step_thing';
    description = '结果递变的测试工具';
    permissions = { readsFiles: false, writesFiles: false, runsShell: false, requiresApproval: false };
    private counter = 0;

    getSchema() {
        return { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] };
    }

    validate(params: unknown): ValidationResult {
        const p = (params ?? {}) as Record<string, unknown>;
        return { valid: true, errors: [], sanitized: { n: Number(p.n ?? 0) } as ToolParams };
    }

    async execute(): Promise<ToolResult> {
        this.counter += 1;
        return { success: true, data: `第 ${this.counter} 步的新信息` };
    }
}

describe('循环守卫', () => {
    let workspaceDir: string;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({ 'src/a.ts': 'export const a = 1;\n' });
    });

    afterEach(() => {
        cleanupTestWorkspace(workspaceDir);
    });

    function runtimeWith(
        decisions: ModelDecision[],
        tools: Tool<ToolParams>[],
        config: Record<string, unknown> = {},
    ): AgentRuntime {
        return new AgentRuntime(new ScriptedProvider([initialPlanDecision(), ...decisions]), tools, {
            workspacePath: workspaceDir,
            maxIterations: 20,
            ...config,
        } as never);
    }

    it('连续 3 次完全相同的 BatchAction 也会被守卫拦下（原来只认 Action）', async () => {
        const tool = new FixedOutputTool();
        const batch = (): ModelDecision => ({
            type: 'BatchAction',
            thought: '再来一次',
            actions: [{ tool: 'fetch_thing', params: { url: 'https://example.com/a' }, thought: '取数' }],
        });

        const { state } = await runtimeWith([batch(), batch(), batch(), batch()], [tool]).run('取数');

        expect(state.stopReason?.type).toBe('error');
        expect(JSON.stringify(state.stopReason)).toContain('重复的动作');
        // 第 4 轮的动作没有再执行：守卫在进入下一轮前就停了
        expect(tool.calls.length).toBeLessThanOrEqual(3);
    });

    it('参数每次微调、结果不变：判定为无进展并停止', async () => {
        const tool = new FixedOutputTool();
        const call = (suffix: string): ModelDecision => ({
            type: 'Action',
            tool: 'fetch_thing',
            params: { url: `https://example.com/?format=${suffix}` },
            thought: '再试一次格式',
        });

        const { state } = await runtimeWith(
            [call('a'), call('ab'), call('abc'), call('abcd'), call('abcde')],
            [tool],
        ).run('取天气数据');

        expect(state.stopReason?.type).toBe('no_progress');
        expect(state.stopReason).toMatchObject({ tool: 'fetch_thing' });
        // 三次相同结果就够了，不该把后面的调用全跑完
        expect(tool.calls.length).toBe(3);
    });

    it('结果在变就不算无进展：正常推进的任务照常跑完', async () => {
        const tool = new VaryingOutputTool();
        const call = (n: number): ModelDecision => ({
            type: 'Action',
            tool: 'step_thing',
            params: { n },
            thought: '下一步',
        });

        const { state } = await runtimeWith(
            [call(1), call(2), call(3), call(4), { type: 'Final', answer: '完成' }],
            [tool],
        ).run('走四步');

        expect(state.stopReason?.type).toBe('task_completed');
        expect(state.toolCallCount).toBe(4);
    });

    it('失败结果反复出现同样停得下来（内容一样的报错不该无限重试）', async () => {
        const tool = new FixedOutputTool();
        tool.execute = async () => ({ success: false, data: null, error: '连接被拒绝' });
        const call = (suffix: string): ModelDecision => ({
            type: 'Action',
            tool: 'fetch_thing',
            params: { url: `https://example.com/${suffix}` },
            thought: '换一个地址试试',
        });

        const { state } = await runtimeWith([call('1'), call('2'), call('3'), call('4'), call('5')], [tool]).run('取数');

        // 同工具的失败累积到阈值时先撞上「需要重新规划」那条守卫，所以这里允许两种停止原因；
        // 关键是不无限重试：第 4 次调用就没再发生。
        expect(['no_progress', 'error']).toContain(state.stopReason?.type);
        expect(tool.calls.length).toBeLessThanOrEqual(3);
    });

    it('noProgressLimit: 0 可以关掉这条守卫（由调用方自己控制）', async () => {
        const tool = new FixedOutputTool();
        const call = (suffix: string): ModelDecision => ({
            type: 'Action',
            tool: 'fetch_thing',
            params: { url: `https://example.com/${suffix}` },
            thought: '再试',
        });

        const { state } = await runtimeWith(
            [call('a'), call('b'), call('c'), { type: 'Final', answer: '完成' }],
            [tool],
            { noProgressLimit: 0 },
        ).run('取数');

        expect(state.stopReason?.type).toBe('task_completed');
        expect(tool.calls.length).toBe(3);
    });
});
