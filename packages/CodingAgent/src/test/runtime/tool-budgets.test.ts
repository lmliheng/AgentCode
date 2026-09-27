// src/test/runtime/tool-budgets.test.ts
//
// 真实工具的预算校准（任务 3.1-3.3）：
//   - 四个感知类工具都声明了字符与行数两个维度
//   - fetch_url 的抓取正文按预算口径截断，全文可读回
//   - run_command 的输出按预算口径截断，且尾部失败摘要仍然可见
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AgentRuntime } from '../../runtime/agent.runtime.js';
import { FetchUrlTool } from '../../tools/fetch_url.js';
import { RunCommandTool } from '../../tools/run_command.js';
import { ReadFileTool } from '../../tools/read_file.js';
import { SearchCodeTool } from '../../tools/search_code.js';
import { ListFilesTool } from '../../tools/list_files.js';
import { ReadDirectoryTool } from '../../tools/read_directory.js';
import { createTestWorkspace, cleanupTestWorkspace, initialPlanDecision } from '../setup.js';
import type { Tool, ToolParams } from '../../types/Tool.js';
import type { AgentRuntimeConfig } from '../../types/Runtime.js';
import type { AgentProvider, AgentProviderConfig, ModelResponse } from '../../types/AgentProvider.js';
import type { ChatMessage, ToolMessage } from '../../types/Message.js';

/** 跑一次「动作 + 完成」，取回送入模型的工具结果内容 */
async function captureToolResultContent(
    workspaceRoot: string,
    tool: Tool<ToolParams>,
    params: Record<string, unknown>,
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
                return { decision: { type: 'Action', tool: tool.name, params, thought: '执行' }, rawContent: '' };
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
        requestApproval: async () => 'approve',
        ...runtimeConfig,
    });

    await runtime.run('执行一次工具调用');

    return captured[captured.length - 1] ?? '';
}

describe('工具预算校准', () => {
    const workspaces: string[] = [];

    afterEach(() => {
        vi.unstubAllGlobals();
        while (workspaces.length > 0) {
            cleanupTestWorkspace(workspaces.pop()!);
        }
    });

    function makeWorkspace(files: Record<string, string>): string {
        const dir = createTestWorkspace(files);
        workspaces.push(dir);
        return dir;
    }

    it('感知类工具都声明了字符与行数两个维度', () => {
        const tools: Tool<ToolParams>[] = [
            new ReadFileTool(),
            new SearchCodeTool(),
            new ListFilesTool(),
            new ReadDirectoryTool(),
        ];

        for (const tool of tools) {
            const budget = tool.outputBudget;
            expect(budget, `${tool.name} 未声明输出预算`).toBeDefined();
            expect(budget!.maxChars, `${tool.name} 缺少字符上限`).toBeGreaterThan(0);
            expect(Number.isFinite(budget!.maxLines), `${tool.name} 缺少行数上限`).toBe(true);
            expect(budget!.maxLines).toBeGreaterThan(0);
        }
    });

    it('run_command 与 fetch_url 也声明了预算（此前分别是无上限与 512KB 口径）', () => {
        for (const tool of [new RunCommandTool(), new FetchUrlTool()] as Tool<ToolParams>[]) {
            const budget = tool.outputBudget;
            expect(budget, `${tool.name} 未声明输出预算`).toBeDefined();
            expect(budget!.maxChars).toBeGreaterThan(0);
            expect(Number.isFinite(budget!.maxLines)).toBe(true);
        }
    });

    it('fetch_url 的超大正文被截断，且完整正文可从落盘位置读回', async () => {
        const workspaceDir = makeWorkspace({ 'src/a.ts': 'export const a = 1;\n' });
        const hugeBody = `BEGIN\n${'z'.repeat(120_000)}\nBODY-END`;

        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers({ 'content-type': 'text/plain' }),
            text: async () => hugeBody,
        })));

        const content = await captureToolResultContent(
            workspaceDir,
            new FetchUrlTool(),
            { url: 'https://example.invalid/big' },
        );

        expect(content).toContain('"truncated":true');

        const parsed = JSON.parse(content);
        expect(parsed.originalLength).toBeGreaterThan(120_000);
        // 截断后保留首尾
        expect(parsed.output.startsWith('{')).toBe(true);
        expect(parsed.output).toContain('BODY-END');

        // 完整正文确实落盘且在工作区之外
        const persisted = resolve(parsed.fullOutputPath as string);
        expect(persisted.startsWith(resolve(workspaceDir))).toBe(false);
        expect(readFileSync(persisted, 'utf-8')).toContain('z'.repeat(1000));
    });

    it('run_command 的输出超限时被截断，但尾部失败摘要仍然可见', async () => {
        const workspaceDir = makeWorkspace({
            'emit.js': [
                'const lines = [];',
                "for (let i = 0; i < 3000; i++) lines.push('正常日志 ' + i + ' ' + 'y'.repeat(30));",
                "console.log(lines.join('\\n'));",
                "console.error('FAIL src/a.test.ts 断言失败：expected 1 to be 2');",
                'process.exit(1);',
                '',
            ].join('\n'),
        });

        const content = await captureToolResultContent(
            workspaceDir,
            new RunCommandTool(),
            { command: 'node emit.js' },
        );

        expect(content).toContain('"truncated":true');

        const parsed = JSON.parse(content);
        // 前段日志在开头
        expect(parsed.output).toContain('正常日志 0');
        // 失败摘要在结尾 —— 这是只保头部会丢掉的信息
        expect(parsed.output).toContain('FAIL src/a.test.ts 断言失败：expected 1 to be 2');
    });
});
