// 验收的第二层：交付物断言。
//
// 老实现只跑仓库自带的测试 / 类型检查（= regression 层），于是「写一份
// results/weather.md」这类任务只要没弄坏测试就能拿到 passed: true —— 即便那个
// 文件根本不存在（见 run_test/PRD.md §7.2）。这组用例钉住的是：任务承诺产出的
// 东西没出来，就必须判「不通过」，并指出缺哪个。

import { afterEach, describe, expect, it } from 'vitest';
import { AgentRuntime } from '../src/agent.runtime.js';
import { CreateFileTool } from '@lmliheng/acode-tools';
import { createTestWorkspace, cleanupTestWorkspace } from './setup.js';
import type {
    AgentProvider,
    AgentProviderConfig,
    ChatMessage,
    ModelDecision,
    ModelResponse,
} from '@lmliheng/acode-core';

/** 按脚本逐轮返回决策的 Provider */
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

/** 与测试运行器同形的汇总行（数量解析靠它，退出码才是权威结论） */
const PASSING_TEST_SCRIPT =
    "console.log('\\u001b[2m      Tests \\u001b[22m \\u001b[1m\\u001b[32m2 passed\\u001b[39m\\u001b[22m\\u001b[90m (2)\\u001b[39m');\n";

function passingPackageJson(): string {
    return JSON.stringify({
        name: 'deliverable-fixture',
        version: '1.0.0',
        scripts: { test: 'node emit-tests.js' },
    });
}

/** 规划轮：声明交付物，步骤只留一步（这组用例不关心计划推进） */
function planDecision(deliverables: unknown): ModelDecision {
    return {
        type: 'Replan',
        reason: '初始规划',
        newPlan: [{
            id: 'step-1',
            description: '产出任务要求的文件',
            status: 'pending',
            dependsOn: [],
            completionCriteria: '文件已写出',
        }],
        // 模型输出在边界上只是 unknown，这里刻意按原样塞进去
        deliverables: deliverables as never,
    };
}

describe('验收：交付物断言', () => {
    const workspaces: string[] = [];

    afterEach(() => {
        while (workspaces.length > 0) {
            cleanupTestWorkspace(workspaces.pop()!);
        }
    });

    function makeWorkspace(files: Record<string, string>): string {
        const dir = createTestWorkspace(files);
        workspaces.push(dir);
        return dir;
    }

    function runtimeFor(
        workspaceDir: string,
        decisions: ModelDecision[],
        config: Record<string, unknown> = {},
    ): AgentRuntime {
        return new AgentRuntime(new ScriptedProvider(decisions), [new CreateFileTool()], {
            workspacePath: workspaceDir,
            maxIterations: 10,
            // 默认策略是 auto-reject，写文件的用例必须显式声明放行
            approvalPolicy: 'auto-approve',
            ...config,
        } as never);
    }

    it('声明的交付物没产出时判不通过，即使回归测试全绿', async () => {
        const workspaceDir = makeWorkspace({
            'package.json': passingPackageJson(),
            'emit-tests.js': PASSING_TEST_SCRIPT,
        });

        const { verification } = await runtimeFor(workspaceDir, [
            planDecision([{ path: 'results/weather.md' }]),
            { type: 'Final', answer: '我写好了（模型自述）' },
        ]).run('把天气写成 results/weather.md');

        // 回归这一层确实过了 —— 老实现到这里就收工，并给出 passed: true
        expect(verification!.layers.regression).toEqual({ executed: true, passed: true });
        expect(verification!.layers.deliverables).toEqual({ declared: 1, passed: false });

        expect(verification!.passed).toBe(false);
        expect(verification!.completionCriteriaMet).toBe(false);
        expect(verification!.deliverables).toEqual([
            { path: 'results/weather.md', ok: false, detail: 'results/weather.md：文件不存在' },
        ]);
        // 缺哪个产物必须写在结论里，而不是只给一个 false
        expect(verification!.details).toContain('results/weather.md');
    });

    it('交付物产出且内容匹配时两层都通过', async () => {
        const workspaceDir = makeWorkspace({
            'package.json': passingPackageJson(),
            'emit-tests.js': PASSING_TEST_SCRIPT,
        });

        const { verification } = await runtimeFor(workspaceDir, [
            planDecision([{ path: 'results/weather.md', contains: '北京' }]),
            {
                type: 'Action',
                tool: 'create_file',
                params: { path: 'results/weather.md', content: '# 天气\n北京 晴\n' },
                thought: '写出交付物',
            },
            { type: 'Final', answer: '完成' },
        ]).run('把天气写成 results/weather.md');

        expect(verification!.deliverables[0]!.ok).toBe(true);
        expect(verification!.layers.deliverables).toEqual({ declared: 1, passed: true });
        expect(verification!.passed).toBe(true);
        expect(verification!.completionCriteriaMet).toBe(true);
        expect(verification!.details).toContain('存在且包含「北京」');
    });

    it('文件在但内容不含声明的文本时判不通过', async () => {
        const workspaceDir = makeWorkspace({ 'results/weather.md': '# 天气\n上海 阴\n' });

        const { verification } = await runtimeFor(workspaceDir, [
            planDecision([{ path: 'results/weather.md', contains: '北京' }]),
            { type: 'Final', answer: '完成' },
        ]).run('写天气');

        expect(verification!.passed).toBe(false);
        expect(verification!.deliverables[0]!.detail).toBe('results/weather.md：缺少「北京」');
    });

    it('调用方声明的交付物与模型声明合并核对', async () => {
        const workspaceDir = makeWorkspace({ 'results/weather.md': '北京 晴\n' });

        const { verification } = await runtimeFor(
            workspaceDir,
            [
                planDecision([{ path: 'results/weather.md' }]),
                { type: 'Final', answer: '完成' },
            ],
            { deliverables: [{ path: 'reports/summary.md' }] },
        ).run('写清单');

        expect(verification!.layers.deliverables).toEqual({ declared: 2, passed: false });
        expect(verification!.deliverables.map(check => check.path)).toEqual([
            'results/weather.md',
            'reports/summary.md',
        ]);
        expect(verification!.deliverables[0]!.ok).toBe(true);
        expect(verification!.deliverables[1]!.ok).toBe(false);
    });

    it('越界路径判不通过，且不会去读工作区之外的文件', async () => {
        const workspaceDir = makeWorkspace({});

        const { verification } = await runtimeFor(workspaceDir, [
            planDecision([{ path: '../../etc/passwd' }]),
            { type: 'Final', answer: '完成' },
        ]).run('越界试试');

        const check = verification!.deliverables[0]!;
        expect(check.ok).toBe(false);
        expect(check.detail).toContain('不在允许的工作区内');
        // 没有「不存在」"缺少"这类读文件之后才会得出的结论
        expect(check.detail).not.toContain('缺少');
    });

    it('没有测试脚本但有交付物声明时，验收仍是可判定的', async () => {
        const workspaceDir = makeWorkspace({ 'out.md': '内容\n' });

        const { verification } = await runtimeFor(workspaceDir, [
            planDecision([{ path: 'out.md' }]),
            { type: 'Final', answer: '完成' },
        ]).run('写 out.md');

        // 老实现一律记成 unavailable（因为工作区没有 package.json）—— 明明判得出的
        expect(verification!.verificationStatus).toBe('executed');
        expect(verification!.layers.regression).toEqual({ executed: false, passed: true });
        expect(verification!.passed).toBe(true);
        expect(verification!.completionCriteriaMet).toBe(true);
    });

    it('没有声明交付物时不引入新的判据（与老行为一致）', async () => {
        const workspaceDir = makeWorkspace({
            'package.json': passingPackageJson(),
            'emit-tests.js': PASSING_TEST_SCRIPT,
        });

        const { verification } = await runtimeFor(workspaceDir, [
            planDecision(undefined),
            { type: 'Final', answer: '完成' },
        ]).run('看看效果');

        expect(verification!.deliverables).toEqual([]);
        expect(verification!.layers.deliverables).toEqual({ declared: 0, passed: true });
        expect(verification!.passed).toBe(true);
    });
});
