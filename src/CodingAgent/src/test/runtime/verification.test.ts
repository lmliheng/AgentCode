// src/test/runtime/verification.test.ts
//
// 覆盖 task-verification spec：
//   - 验收独立于模型自述
//   - 验证手段从工作区推断
//   - 验收产出结构化结论
//   - 验收结论与停止原因相互独立
import { describe, it, expect, afterEach } from 'vitest';
import { AgentRuntime } from '../../runtime/agent.runtime.js';
import { ReadFileTool } from '../../tools/read_file.js';
import { CreateFileTool } from '../../tools/create_file.js';
import { RunCommandTool } from '../../tools/run_command.js';
import { createTestWorkspace, cleanupTestWorkspace } from '../setup.js';
import type { AgentProvider, AgentProviderConfig, ModelResponse } from '../../types/AgentProvider.js';
import type { ChatMessage } from '../../types/Message.js';
import type { ModelDecision } from '../../types/ReAct.js';

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

/**
 * 让测试脚本输出与测试运行器同形的汇总行。
 *
 * 刻意保留 ANSI 颜色转义：真实运行器默认输出就是彩色的，而转义序列里的
 * 非空白字符曾让计数解析整体失效（计数恒为 0）。fixture 必须是同一形状，
 * 否则这条路径测不到。
 */
const PASSING_TEST_SCRIPT =
    "console.log('\\u001b[2m      Tests \\u001b[22m \\u001b[1m\\u001b[32m2 passed\\u001b[39m\\u001b[22m\\u001b[90m (2)\\u001b[39m');\n";
const FAILING_TEST_SCRIPT =
    "console.log('\\u001b[2m      Tests \\u001b[22m \\u001b[1m\\u001b[31m1 failed\\u001b[39m\\u001b[22m\\u001b[90m | \\u001b[39m\\u001b[1m\\u001b[32m1 passed\\u001b[39m\\u001b[22m\\u001b[90m (2)\\u001b[39m');\nprocess.exit(1);\n";

const TSC_PASSING = "// stub tsc\nprocess.exit(0);\n";
const TSC_FAILING = "// stub tsc\nconsole.error('error TS1005: 需要 ;');\nprocess.exit(1);\n";

function packageJson(): string {
    return JSON.stringify({
        name: 'verification-fixture',
        version: '1.0.0',
        scripts: { test: 'node emit-tests.js' },
    });
}

describe('Runtime 独立复验', () => {
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

    function runtimeFor(workspaceDir: string, decisions: ModelDecision[]): AgentRuntime {
        return new AgentRuntime(new ScriptedProvider(decisions), [new ReadFileTool(), new CreateFileTool(), new RunCommandTool()], {
            workspacePath: workspaceDir,
            maxIterations: 5,
        });
    }

    it('同时存在测试脚本与类型检查配置时执行两项', async () => {
        const workspaceDir = makeWorkspace({
            'package.json': packageJson(),
            'emit-tests.js': PASSING_TEST_SCRIPT,
            'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
            'node_modules/typescript/bin/tsc': TSC_PASSING,
        });

        const { verification } = await runtimeFor(workspaceDir, [
            { type: 'Final', answer: '完成' },
        ]).run('跑一下验证');

        expect(verification).toBeDefined();
        expect(verification!.verificationStatus).toBe('executed');

        // 测试汇总行被解析出真实数量，而不是恒为 0
        expect(verification!.testResults.passed).toBe(2);
        expect(verification!.testResults.failed).toBe(0);

        // 类型检查确实执行了，且结论来自实际退出码
        expect(verification!.typeCheckPassed).toBe(true);

        expect(verification!.details).toContain('test [npm test]');
        expect(verification!.details).toContain('typecheck [');
    });

    it('仅存在测试脚本时，类型检查结论标记为未执行而非失败', async () => {
        const workspaceDir = makeWorkspace({
            'package.json': packageJson(),
            'emit-tests.js': PASSING_TEST_SCRIPT,
        });

        const { verification } = await runtimeFor(workspaceDir, [
            { type: 'Final', answer: '完成' },
        ]).run('跑一下验证');

        expect(verification!.verificationStatus).toBe('executed');
        // null = 未执行，与「失败」区分
        expect(verification!.typeCheckPassed).toBeNull();
        expect(verification!.passed).toBe(true);
    });

    it('没有任何可用验证手段时标记为不可判定，且不算通过', async () => {
        const workspaceDir = makeWorkspace({ 'README.md': '# 空项目\n' });

        const { verification } = await runtimeFor(workspaceDir, [
            { type: 'Final', answer: '完成' },
        ]).run('跑一下验证');

        expect(verification!.verificationStatus).toBe('unavailable');
        expect(verification!.passed).toBe(false);
        expect(verification!.completionCriteriaMet).toBe(false);
        expect(verification!.typeCheckPassed).toBeNull();
    });

    it('以完成停止而验收不通过时，停止原因与验收结论同时可读', async () => {
        const workspaceDir = makeWorkspace({
            'package.json': packageJson(),
            'emit-tests.js': FAILING_TEST_SCRIPT,
        });

        const { state, verification } = await runtimeFor(workspaceDir, [
            { type: 'Final', answer: '我已完成（模型自述）' },
        ]).run('跑一下验证');

        // 停止原因不被验收结论覆盖
        expect(state.stopReason?.type).toBe('task_completed');

        // 验收独立于模型自述：模型说完成，但测试失败
        expect(verification!.passed).toBe(false);
        expect(verification!.completionCriteriaMet).toBe(false);
        expect(verification!.testResults.failed).toBe(1);
        expect(verification!.testResults.passed).toBe(1);
    });

    it('类型检查失败会独立体现在结论中', async () => {
        const workspaceDir = makeWorkspace({
            'package.json': packageJson(),
            'emit-tests.js': PASSING_TEST_SCRIPT,
            'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
            'node_modules/typescript/bin/tsc': TSC_FAILING,
        });

        const { verification } = await runtimeFor(workspaceDir, [
            { type: 'Final', answer: '完成' },
        ]).run('跑一下验证');

        expect(verification!.typeCheckPassed).toBe(false);
        expect(verification!.typeCheckOutput).toContain('TS1005');
        // 测试通过但类型检查失败 -> 整体不通过
        expect(verification!.passed).toBe(false);
    });

    it('变更摘要列出运行期间实际改动过的文件', async () => {
        const workspaceDir = makeWorkspace({
            'package.json': packageJson(),
            'emit-tests.js': PASSING_TEST_SCRIPT,
        });

        const runtime = new AgentRuntime(
            new ScriptedProvider([
                {
                    type: 'Action',
                    tool: 'create_file',
                    params: { path: 'src/generated.ts', content: 'export const generated = true;\n' },
                    thought: '创建文件',
                },
                { type: 'Final', answer: '完成' },
            ]),
            [new CreateFileTool()],
            {
                workspacePath: workspaceDir,
                maxIterations: 5,
                requestApproval: async () => 'approve',
            },
        );

        const { verification } = await runtime.run('创建文件');

        expect(verification!.diffSummary).toContain('src/generated.ts');
        expect(verification!.diffSummary).not.toContain('没有文件变更');
    });

    it('没有文件变更时变更摘要如实说明', async () => {
        const workspaceDir = makeWorkspace({
            'package.json': packageJson(),
            'emit-tests.js': PASSING_TEST_SCRIPT,
        });

        const { verification } = await runtimeFor(workspaceDir, [
            { type: 'Final', answer: '完成' },
        ]).run('只看不改');

        expect(verification!.diffSummary).toContain('没有文件变更');
    });
});
