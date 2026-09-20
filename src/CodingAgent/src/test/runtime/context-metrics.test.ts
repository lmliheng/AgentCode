// src/test/runtime/context-metrics.test.ts
//
// 覆盖 context-metrics spec：
//   - 当前上下文大小与累计消耗分开可读
//   - 度量标注来源为实测或估算
//   - 预算判据的来源明确且可配置
//   - 度量本身不改变运行行为
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentRuntime } from '../../runtime/agent.runtime.js';
import { ReadFileTool } from '../../tools/read_file.js';
import { DERIVED_CONTEXT_TOKEN_BUDGET, DEFAULT_OUTPUT_BUDGET } from '../../output-budget.js';
import { createTestWorkspace, cleanupTestWorkspace } from '../setup.js';
import type { AgentProvider, AgentProviderConfig, ModelResponse, TokenUsage } from '../../types/AgentProvider.js';
import type { AgentRuntimeConfig } from '../../types/Runtime.js';
import type { ChatMessage } from '../../types/Message.js';
import type { ModelDecision } from '../../types/ReAct.js';

class ScriptedProvider implements AgentProvider {
    readonly name = 'scripted';
    config: AgentProviderConfig = { modelName: 'scripted', temperature: 0, maxTokens: 100 };
    private index = 0;

    constructor(private readonly script: Array<{ decision: ModelDecision; usage?: TokenUsage }>) {}

    updateConfig(): void {
        // 测试用，无需实现
    }

    async decide(): Promise<ModelResponse> {
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

/** 每次 decide 都抛错，用于观察「尚未完成任何请求」时的状态 */
class FailingProvider implements AgentProvider {
    readonly name = 'failing';
    config: AgentProviderConfig = { modelName: 'failing', temperature: 0, maxTokens: 100 };
    updateConfig(): void { /* noop */ }
    async decide(): Promise<ModelResponse> {
        throw new Error('模拟请求失败');
    }
}

/** 两轮读取后完成 —— 多轮脚本，用于度量与行为对比 */
function readTwiceScript(): Array<{ decision: ModelDecision; usage?: TokenUsage }> {
    return [
        {
            decision: { type: 'Action', tool: 'read_file', params: { path: 'src/a.ts' }, thought: '第一次' },
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
            decision: { type: 'Action', tool: 'read_file', params: { path: 'src/a.ts' }, thought: '第二次' },
            usage: { promptTokens: 20, completionTokens: 7, totalTokens: 27 },
        },
        {
            decision: { type: 'Final', answer: '完成' },
            usage: { promptTokens: 30, completionTokens: 3, totalTokens: 33 },
        },
    ];
}

describe('上下文度量', () => {
    let workspaceDir: string;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({ 'src/a.ts': 'export const a = 1;\n' });
    });

    afterEach(() => {
        cleanupTestWorkspace(workspaceDir);
    });

    function runtimeFor(
        provider: AgentProvider,
        config: Partial<AgentRuntimeConfig> = {},
    ): AgentRuntime {
        return new AgentRuntime(provider, [new ReadFileTool()], {
            workspacePath: workspaceDir,
            maxIterations: 5,
            ...config,
        });
    }

    it('当前上下文大小取最近一轮输入量，累计消耗取各轮之和，两者分别可读', async () => {
        const { state } = await runtimeFor(new ScriptedProvider(readTwiceScript())).run('读两次');

        // 当前上下文大小 = 最近一轮的输入量
        expect(state.contextSize.tokens).toBe(30);
        expect(state.contextSize.source).toBe('measured');

        // 累计消耗 = 各轮之和
        expect(state.tokenUsage.promptTokens).toBe(60);
        expect(state.tokenUsage.totalTokens).toBe(15 + 27 + 33);

        // 两个口径必须不同，不能是同一个数字
        expect(state.contextSize.tokens).not.toBe(state.tokenUsage.promptTokens);
    });

    it('模型响应未带用量时标记为估算，而不是伪装成实测', async () => {
        const script = readTwiceScript().map(({ decision }) => ({ decision }));

        const { state } = await runtimeFor(new ScriptedProvider(script)).run('读两次');

        expect(state.contextSize.source).toBe('estimated');
        expect(state.contextSize.tokens).toBeGreaterThan(0);
        // 累计值同样如实标记为不完整
        expect(state.tokenUsage.complete).toBe(false);
    });

    it('尚未完成任何请求时标记为未知，而不是 0', async () => {
        const { state } = await runtimeFor(new FailingProvider()).run('注定失败');

        expect(state.stopReason?.type).toBe('error');
        expect(state.contextSize.tokens).toBeNull();
        expect(state.contextSize.source).toBe('unknown');
    });

    it('预算判据可由配置提供，且来源标记为 config', () => {
        const runtime = runtimeFor(new ScriptedProvider([]), {
            contextTokenBudget: 4096,
            outputBudget: { maxChars: 1234, maxLines: 56 },
        });

        const judgement = runtime.getContextBudget();

        expect(judgement.contextTokens.value).toBe(4096);
        expect(judgement.contextTokens.source).toBe('config');
        expect(judgement.toolOutput.maxChars).toBe(1234);
        expect(judgement.toolOutput.maxLines).toBe(56);
        expect(judgement.toolOutput.source).toBe('config');
    });

    it('未提供配置时使用推导默认值，且依据可读', () => {
        const judgement = runtimeFor(new ScriptedProvider([])).getContextBudget();

        expect(judgement.contextTokens.source).toBe('derived');
        expect(judgement.contextTokens.value).toBe(DERIVED_CONTEXT_TOKEN_BUDGET);
        expect(judgement.contextTokens.rationale.length).toBeGreaterThan(0);

        expect(judgement.toolOutput.source).toBe('derived');
        expect(judgement.toolOutput.maxChars).toBe(DEFAULT_OUTPUT_BUDGET.maxChars);
        expect(judgement.toolOutput.rationale.length).toBeGreaterThan(0);
    });

    it('度量超过判据不改变运行行为：不压缩历史、不提前停止', async () => {
        const baseline = await runtimeFor(new ScriptedProvider(readTwiceScript())).run('读两次');

        // 把阈值设成必然被超过的极小值
        const overshoot = await runtimeFor(new ScriptedProvider(readTwiceScript()), {
            contextTokenBudget: 1,
        }).run('读两次');

        // 前提成立：当前上下文大小确实超过了判据
        expect(overshoot.state.contextSize.tokens).toBeGreaterThan(1);

        // 行为与未超过时完全一致
        expect(overshoot.state.decisions.length).toBe(baseline.state.decisions.length);
        expect(overshoot.state.observations.length).toBe(baseline.state.observations.length);
        expect(overshoot.state.toolCallCount).toBe(baseline.state.toolCallCount);
        expect(overshoot.state.iterationCount).toBe(baseline.state.iterationCount);
        expect(overshoot.state.stopReason).toEqual(baseline.state.stopReason);
        expect(overshoot.state.stopReason?.type).toBe('task_completed');
    });
});
