// src/test/runtime/output-budget.test.ts
//
// 覆盖 tool-output-budget spec：
//   - 字符与行数双重上限
//   - 截断保留首尾
//   - 完整输出外部化到工作区之外
//   - 截断幂等
//   - 工具级预算与运行时兜底两级并存
//   - 无输出有明确表示
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    applyOutputBudget,
    isAlreadyTruncated,
    TRUNCATION_MARKER,
    NO_OUTPUT_PLACEHOLDER,
    DEFAULT_OUTPUT_BUDGET,
} from '../../output-budget.js';
import type { OutputBudget } from '../../output-budget.js';
import { AgentRuntime } from '../../runtime/agent.runtime.js';
import { createTestWorkspace, cleanupTestWorkspace, initialPlanDecision } from '../setup.js';
import type { Tool, ToolParams, ToolResult, ValidationResult } from '../../types/Tool.js';
import type { AgentRuntimeConfig } from '../../types/Runtime.js';
import type { AgentProvider, AgentProviderConfig, ModelResponse } from '../../types/AgentProvider.js';
import type { ChatMessage, ToolMessage } from '../../types/Message.js';

/** 返回固定 data 的测试工具；budget 省略时表示「未声明预算」 */
class FakeTool implements Tool<ToolParams> {
    readonly permissions = {
        readsFiles: false,
        writesFiles: false,
        runsShell: false,
        requiresApproval: false,
    };
    readonly outputBudget?: OutputBudget;

    constructor(
        readonly name: string,
        private readonly data: unknown,
        budget?: OutputBudget,
    ) {
        if (budget) this.outputBudget = budget;
    }

    readonly description = '测试用工具';

    getSchema(): Record<string, unknown> {
        return { type: 'object', properties: {}, required: [] };
    }

    validate(): ValidationResult {
        return { valid: true, errors: [], sanitized: {} as ToolParams };
    }

    async execute(): Promise<ToolResult> {
        return { success: true, data: this.data };
    }
}

/**
 * 跑一次「动作 + 完成」，取回送入模型的工具结果内容。
 */
async function captureToolResultContent(
    workspaceRoot: string,
    tool: Tool<ToolParams>,
    runtimeConfig: Partial<AgentRuntimeConfig> = {},
): Promise<string> {
    const captured: string[] = [];
    let turn = 0;

    const provider: AgentProvider = {
        name: 'capturing',
        config: { modelName: 'capturing', temperature: 0, maxTokens: 100 },
        updateConfig() { /* noop */ },
        async decide(incoming: ChatMessage[]): Promise<ModelResponse> {
            turn += 1;

            // 第一轮是进入循环前的规划轮，这里只取计划
            if (turn === 1) {
                return { decision: initialPlanDecision(), rawContent: '' };
            }
            if (turn === 2) {
                return { decision: { type: 'Action', tool: tool.name, params: {}, thought: '产生输出' }, rawContent: '' };
            }

            // 第三轮才带上了执行结果
            for (const message of incoming) {
                if (message.role === 'tool') captured.push((message as ToolMessage).content);
            }
            return { decision: { type: 'Final', answer: '完成' }, rawContent: '' };
        },
    };

    const runtime = new AgentRuntime(provider, [tool], {
        workspacePath: workspaceRoot,
        maxIterations: 3,
        ...runtimeConfig,
    });

    await runtime.run('产生一次输出');

    return captured[captured.length - 1] ?? '';
}

describe('工具输出预算（模块层）', () => {
    let workspaceDir: string;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({ 'src/a.ts': 'export const a = 1;\n' });
    });

    afterEach(() => {
        cleanupTestWorkspace(workspaceDir);
    });

    function apply(content: string, budget?: OutputBudget) {
        return applyOutputBudget(content, {
            toolName: 'test_tool',
            workspaceRoot: workspaceDir,
            ...(budget ? { budget } : {}),
        });
    }

    it('超出字符上限时被截断并标明截断', () => {
        const content = 'x'.repeat(500);

        const outcome = apply(content, { maxChars: 100, maxLines: Number.POSITIVE_INFINITY });

        expect(outcome.truncated).toBe(true);
        expect(outcome.content).toContain(TRUNCATION_MARKER);
        expect(outcome.content.length).toBeLessThan(content.length);
        expect(outcome.originalLength).toBe(500);
    });

    it('行数超出而字符数未超时仍然被截断', () => {
        // 大量短行：行数远超上限，但字符总数远低于字符上限
        const content = Array.from({ length: 2000 }, (_, i) => `L${i}`).join('\n');
        expect(content.split('\n').length).toBe(2000);
        expect(content.length).toBeLessThan(50000); // 前提：字符维度不会触发

        const outcome = apply(content, { maxChars: 50000, maxLines: 100 });

        expect(outcome.truncated).toBe(true);
        expect(outcome.content).toContain('省略');
        expect(outcome.content.split('\n').length).toBeLessThan(200);
    });

    it('上限被显式关闭时不截断', () => {
        const content = 'x'.repeat(500);

        const outcome = apply(content, { maxChars: 0, maxLines: 10 });

        expect(outcome.truncated).toBe(false);
        expect(outcome.content).toBe(content);
    });

    it('截断保留首尾，尾部失败摘要仍然可见', () => {
        const head = Array.from({ length: 400 }, (_, i) => `正常日志 ${i} ${'y'.repeat(40)}`).join('\n');
        const tail = 'FAIL src/a.test.ts > 断言失败：expected 1 to be 2';
        const content = `${head}\n${tail}`;

        const outcome = apply(content, { maxChars: 2000, maxLines: Number.POSITIVE_INFINITY });

        expect(outcome.truncated).toBe(true);
        expect(outcome.content.startsWith('正常日志 0')).toBe(true);
        // 尾部保留 —— 只保头部做不到这一点
        expect(outcome.content.trimEnd().endsWith(tail)).toBe(true);
    });

    it('截断时把完整内容外部化到工作区之外，且可读回', () => {
        const content = 'z'.repeat(3000);

        const outcome = apply(content, { maxChars: 200, maxLines: Number.POSITIVE_INFINITY });

        expect(outcome.truncated).toBe(true);
        expect(outcome.fullOutputPath).toBeTruthy();

        const persisted = resolve(outcome.fullOutputPath!);
        // 位置必须在工作区之外，否则会污染 git / read_directory / search_code
        expect(persisted.startsWith(resolve(workspaceDir))).toBe(false);
        // 全文可读回，说明截断并未丢数据
        expect(readFileSync(persisted, 'utf-8')).toBe(content);
    });

    it('落盘路径由内容决定，重复派生得到同一路径', () => {
        const content = 'w'.repeat(3000);
        const budget: OutputBudget = { maxChars: 200, maxLines: Number.POSITIVE_INFINITY };

        // 工具结果消息每轮都从观察重新派生一次。路径若带随机量，同一段历史每轮
        // 都长得不一样，服务端前缀缓存会从第一条被截断的结果起永久失配。
        const first = apply(content, budget);
        const second = apply(content, budget);

        expect(second.fullOutputPath).toBe(first.fullOutputPath);
        // 内容不同则路径不同，两份全文不会叠在同一条路径上
        expect(apply('v'.repeat(3000), budget).fullOutputPath).not.toBe(first.fullOutputPath);
    });

    it('已截断的内容不被再次截断（幂等）', () => {
        const content = 'q'.repeat(3000);
        const budget: OutputBudget = { maxChars: 300, maxLines: Number.POSITIVE_INFINITY };

        const first = apply(content, budget);
        expect(first.truncated).toBe(true);

        const second = apply(first.content, budget);

        expect(isAlreadyTruncated(first.content)).toBe(true);
        expect(second.content).toBe(first.content);
        // 不产生嵌套或重复标记
        expect(second.content.split(TRUNCATION_MARKER).length)
            .toBe(first.content.split(TRUNCATION_MARKER).length);
    });

    it('空白内容得到明确占位而不是空字符串', () => {
        expect(apply('').content).toBe(NO_OUTPUT_PLACEHOLDER);
        expect(apply('   \n  ').content).toBe(NO_OUTPUT_PLACEHOLDER);
    });

    it('行数上限设为无限时只受字符约束，全局行数上限不削掉工具预算', () => {
        const content = Array.from({ length: 3000 }, (_, i) => `S${i}`).join('\n');

        const outcome = apply(content, { maxChars: 1000, maxLines: Number.POSITIVE_INFINITY });

        expect(outcome.truncated).toBe(true);
        // 只发生字符维度的截断；若全局行数上限也生效，会出现「省略 N 行」
        expect(outcome.content).toContain('字符');
        expect(outcome.content).not.toContain('行');
    });

    it('默认全局预算为字符与行数双维上限', () => {
        expect(DEFAULT_OUTPUT_BUDGET.maxChars).toBeGreaterThan(0);
        expect(Number.isFinite(DEFAULT_OUTPUT_BUDGET.maxLines)).toBe(true);
    });
});

describe('工具输出预算（运行时兜底）', () => {
    let workspaceDir: string;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({ 'src/a.ts': 'export const a = 1;\n' });
    });

    afterEach(() => {
        cleanupTestWorkspace(workspaceDir);
    });

    it('未声明预算的工具也受全局默认约束', async () => {
        // 超过默认字符上限（8000）的输出
        const tool = new FakeTool('huge_output', { output: 'h'.repeat(20000) });

        const content = await captureToolResultContent(workspaceDir, tool);

        expect(content).toContain('"truncated":true');
        expect(content).toContain('fullOutputPath');
        expect(content.length).toBeLessThan(20000);
    });

    it('工具声明的预算覆盖全局默认', async () => {
        const tool = new FakeTool(
            'huge_output',
            { output: 'm'.repeat(4000) },
            { maxChars: 10000, maxLines: Number.POSITIVE_INFINITY },
        );

        // 全局被配置成极小；工具自身预算更宽，应当按工具的处理
        const content = await captureToolResultContent(workspaceDir, tool, {
            outputBudget: { maxChars: 100, maxLines: 5 },
        });

        expect(content).not.toContain('"truncated":true');
        expect(content).toContain('m'.repeat(100));
    });

    it('既未声明也未被配置时使用推导默认值', async () => {
        const tool = new FakeTool('huge_output', { output: 'd'.repeat(9000) });

        const content = await captureToolResultContent(workspaceDir, tool);

        expect(content).toContain('"truncated":true');
    });

    it('成功但没有任何输出时给出占位说明', async () => {
        const emptyTool = new FakeTool('huge_output', null);

        const content = await captureToolResultContent(workspaceDir, emptyTool);

        expect(content).toBe(NO_OUTPUT_PLACEHOLDER);
    });
});
