// 成本闸门：累计 token 达到上限即停止。
//
// 原来只有迭代次数 / 工具调用数 / 文件变更数三种预算，没有一处看 token ——
// 长任务只能「跑完才发现烧了多少」（run_test/PRD.md §1.1 的 340,634 就是实例）。

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
    TokenUsage,
    ToolParams,
    ToolResult,
    ValidationResult,
} from '@lmliheng/acode-core';

const USAGE: TokenUsage = { promptTokens: 600, completionTokens: 50, totalTokens: 650 };

class UsageProvider implements AgentProvider {
    readonly name = 'usage';
    config: AgentProviderConfig = { modelName: 'usage', temperature: 0, maxTokens: 100 };
    private index = 0;

    constructor(private readonly decisions: ModelDecision[]) {}

    updateConfig(): void {
        // 测试用
    }

    async decide(_messages: ChatMessage[]): Promise<ModelResponse> {
        const decision = this.decisions[this.index] ?? { type: 'Final' as const, answer: '结束' };
        this.index += 1;
        return { decision, rawContent: '', usage: USAGE };
    }
}

class NoopTool implements Tool<ToolParams> {
    name = 'noop_tool';
    description = '什么也不做的测试工具';
    permissions = { readsFiles: false, writesFiles: false, runsShell: false, requiresApproval: false };

    getSchema() {
        return { type: 'object', properties: { n: { type: 'number' } }, required: [] };
    }

    validate(params: unknown): ValidationResult {
        const p = (params ?? {}) as Record<string, unknown>;
        return { valid: true, errors: [], sanitized: { n: Number(p.n ?? 0) } as ToolParams };
    }

    async execute(params: ToolParams): Promise<ToolResult> {
        return { success: true, data: `第 ${(params as { n: number }).n} 步` };
    }
}

describe('token 成本闸门', () => {
    let workspaceDir: string;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({ 'src/a.ts': 'export const a = 1;\n' });
    });

    afterEach(() => {
        cleanupTestWorkspace(workspaceDir);
    });

    function runtimeWith(config: Record<string, unknown>) {
        const decisions: ModelDecision[] = Array.from({ length: 10 }, (_, i) => ({
            type: 'Action' as const,
            tool: 'noop_tool',
            params: { n: i + 1 },
            thought: '继续',
        }));
        return new AgentRuntime(new UsageProvider([initialPlanDecision(), ...decisions]), [new NoopTool()], {
            workspacePath: workspaceDir,
            maxIterations: 20,
            ...config,
        } as never);
    }

    it('累计用量达到上限即停止，停止原因是 max_tokens', async () => {
        // 每轮 650 tokens，上限 2000 —— 第 4 轮开始就超了（规划轮也计入累计）
        const { state } = await runtimeWith({ maxTokens: 2000 }).run('一直做下去');

        expect(state.stopReason?.type).toBe('max_tokens');
        expect(state.stopReason).toMatchObject({ limit: 2000 });
        // 停的时候确实已经越过了上限（不是提前停）
        expect(state.tokenUsage.totalTokens).toBeGreaterThanOrEqual(2000);
    });

    it('不设上限时不受影响（默认不限制）', async () => {
        const { state } = await runtimeWith({}).run('一直做下去');

        // 脚本走完（10 步）由模型自己收尾 —— 没有因为用量被拦下
        expect(state.stopReason?.type).toBe('task_completed');
        expect(state.tokenUsage.totalTokens).toBeGreaterThan(2000);
    });

    it('上限为 0 等同于不限制（不会一启动就停）', async () => {
        const { state } = await runtimeWith({ maxTokens: 0 }).run('一直做下去');

        expect(state.stopReason?.type).not.toBe('max_tokens');
    });
});
