// src/test/runtime/observation-delivery.test.ts
//
// 观察的「送出量」度量（见 core 的 ObservationDelivery）。
//
// 要钉住的是两件事：
//   1. trace 里那两个数字必须与真正发给模型的内容对得上 —— 对不上的度量比没有度量更糟，
//      它会让人放心地下错判断；
//   2. 每条记录下来的观察都得有这份度量，包括「没能执行」的那些失败观察。
import { describe, it, expect, afterEach } from 'vitest';
import { AgentRuntime } from '../src/agent.runtime.js';
import { createTestWorkspace, cleanupTestWorkspace, initialPlanDecision } from './setup.js';
import type {
    AgentProvider,
    AgentProviderConfig,
    ChatMessage,
    ModelResponse,
    Tool,
    ToolParams,
    ToolResult,
    ValidationResult,
} from '@lmliheng/acode-core';

/** 按固定长度产出内容的工具，用来把「截断」逼出来 */
class SizedTool implements Tool<ToolParams> {
    name = 'sized_tool';
    description = '产出指定长度内容的测试工具';
    permissions = { readsFiles: false, writesFiles: false, runsShell: false, requiresApproval: false };

    constructor(private readonly size: number) {}

    getSchema() {
        return { type: 'object', properties: { n: { type: 'number' } }, required: [] };
    }

    validate(params: unknown): ValidationResult {
        const p = (params ?? {}) as Record<string, unknown>;
        return { valid: true, errors: [], sanitized: { n: Number(p.n ?? 0) } as ToolParams };
    }

    async execute(): Promise<ToolResult> {
        return { success: true, data: 'x'.repeat(this.size) };
    }
}

describe('观察的送出量度量', () => {
    const workspaces: string[] = [];

    afterEach(() => {
        while (workspaces.length > 0) {
            cleanupTestWorkspace(workspaces.pop()!);
        }
    });

    /** 跑一次工具调用，返回运行后的 state 与最后一次请求里送出的工具结果内容 */
    async function runOnce(
        tools: Tool<ToolParams>[],
        decisions: unknown[],
        config: Record<string, unknown> = {},
    ) {
        const workspaceDir = createTestWorkspace({ 'src/a.ts': 'export const a = 1;\n' });
        workspaces.push(workspaceDir);

        const sent: string[] = [];
        let turn = 0;
        const provider: AgentProvider = {
            name: 'capturing',
            config: { modelName: 'capturing', temperature: 0, maxTokens: 100 } as AgentProviderConfig,
            updateConfig() { /* 测试用 */ },
            async decide(incoming: ChatMessage[]): Promise<ModelResponse> {
                turn += 1;
                const next = decisions[turn - 1];
                if (next !== undefined) return { decision: next as never, rawContent: '' };
                for (const message of incoming) {
                    if (message.role === 'tool') sent.push(message.content ?? '');
                }
                return { decision: { type: 'Final', answer: '完成' }, rawContent: '' };
            },
        };

        const runtime = new AgentRuntime(provider, tools, {
            workspacePath: workspaceDir,
            maxIterations: 5,
            approvalPolicy: 'auto-approve',
            ...config,
        } as never);

        const result = await runtime.run('跑一次');
        return { state: result.state, sent };
    }

    it('大输出被截断：两个数字都记下来，且与真正送出的内容对得上', async () => {
        const { state, sent } = await runOnce(
            [new SizedTool(200_000)],
            [
                initialPlanDecision(),
                { type: 'Action', tool: 'sized_tool', params: { n: 1 }, thought: '做' },
            ],
        );

        const observation = state.observations[0]!;
        const delivery = observation.delivery;
        expect(delivery, '观察缺少送出量度量').toBeDefined();
        expect(delivery!.truncated).toBe(true);
        // 原始产出的 JSON 里带着这 20 万个字符
        expect(delivery!.rawChars).toBeGreaterThan(200_000);
        expect(delivery!.deliveredChars).toBeLessThan(delivery!.rawChars);
        // 截断后能找回全文，否则模型（和人都）没法接着看
        expect(delivery!.fullOutputPath).not.toBeNull();

        // 度量必须等于真正送出去的那一份：两处各算一次就会在这里分叉
        expect(sent[sent.length - 1]!.length).toBe(delivery!.deliveredChars);
    });

    it('小输出不截断：送出量与原始产出一致', async () => {
        const { state } = await runOnce(
            [new SizedTool(10)],
            [
                initialPlanDecision(),
                { type: 'Action', tool: 'sized_tool', params: { n: 1 }, thought: '做' },
            ],
        );

        const delivery = state.observations[0]!.delivery!;
        expect(delivery.truncated).toBe(false);
        expect(delivery.deliveredChars).toBe(delivery.rawChars);
        expect(delivery.fullOutputPath).toBeNull();
    });

    it('没能执行的失败观察也有送出量（不止执行成功那条路径）', async () => {
        const { state } = await runOnce(
            [new SizedTool(10)],
            [
                initialPlanDecision(),
                // 不存在的工具：走 pushFailureObservation 那条路
                { type: 'Action', tool: 'no_such_tool', params: {}, thought: '做' },
            ],
        );

        const observation = state.observations[0]!;
        expect(observation.result.success).toBe(false);
        expect(observation.delivery).toBeDefined();
        expect(observation.delivery!.deliveredChars).toBeGreaterThan(0);
    });
});
