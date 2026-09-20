// src/test/integration/react_loop.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { AgentRuntime } from '../../runtime/agent.runtime.js';
import { ReadFileTool } from '../../tools/read_file.js';
import { EditFileTool } from '../../tools/edit_file.js';
import { SearchCodeTool } from '../../tools/search_code.js';
import { RunCommandTool } from '../../tools/run_command.js';
import { CreateFileTool } from '../../tools/create_file.js';
import { ListFilesTool } from '../../tools/list_files.js';
import { ReadDirectoryTool } from '../../tools/read_directory.js';
import { DeleteFileTool } from '../../tools/delete_file.js';
import { MoveFileTool } from '../../tools/move_file.js';
import { ApplyDiffTool } from '../../tools/apply_diff.js';
import { GitOperationTool } from '../../tools/git_operation.js';
import { FetchUrlTool } from '../../tools/fetch_url.js';
import { createTestWorkspace, cleanupTestWorkspace } from '../setup.js';
import type { Tool, ToolParams, ToolContext, ToolResult } from '../../types/Tool.js';
import type { AgentProvider, ToolDefinition, AgentProviderConfig, ModelResponse } from '../../types/AgentProvider.js';
import type { ChatMessage } from '../../types/Message.js';
import type { ModelDecision } from '../../types/ReAct.js'


/**
 * Mock Provider：模拟 LLM 的决策
 * 
 * 这个 provider 会按照预设的决策序列执行，
 * 用于测试 Agent Runtime 能否正确处理各种场景
 */
class MockProvider implements AgentProvider {
    readonly name = 'mock-provider'
    public config: AgentProviderConfig = {
        modelName: 'mock',
        temperature: 0,
        maxTokens: 100
    }
    private decisions: ModelDecision[]
    private currentIndex = 0

    constructor(decisions: ModelDecision[]) {
        this.decisions = decisions
    }

    updateConfig(config: Partial<AgentProviderConfig>): void {
        this.config = { ...this.config, ...config }
    }

    async decide(_messages: ChatMessage[], _tools: ToolDefinition[]): Promise<ModelResponse> {
        const decision = this.decisions[this.currentIndex]!
        this.currentIndex++

        return {
            decision,
            rawContent: JSON.stringify({ action: 'list_files', path: '/tmp' }),
            reasoningContent: null,
            finishReason: 'stop',
            modelName: 'mock-model',
            usage: {
                promptTokens: 10,
                completionTokens: 20,
                totalTokens: 30
            }
        }
    }
}





describe('Agent Runtime Integration', () => {
    let workspaceDir: string;
    let runtime: AgentRuntime;
    let tools: Tool<ToolParams>[];

    beforeEach(() => {
        workspaceDir = createTestWorkspace({
            'src/index.ts': `
function greet(name: string): string {
    return \`Hello, \${name}!\`;
}

console.log(greet('World'));
`.trim(),
            'package.json': JSON.stringify({
                name: 'test-project',
                version: '1.0.0',
                scripts: {
                    test: 'echo "tests passed"',
                },
            }),
        });

        // 初始化 git 仓库
        execSync('git init', { cwd: workspaceDir, stdio: 'pipe' });
        execSync('git config user.email "test@test.com"', { cwd: workspaceDir, stdio: 'pipe' });
        execSync('git config user.name "Test"', { cwd: workspaceDir, stdio: 'pipe' });
        execSync('git add .', { cwd: workspaceDir, stdio: 'pipe' });
        execSync('git commit -m "initial commit"', { cwd: workspaceDir, stdio: 'pipe' });

        tools = [
            new ReadFileTool(),
            new EditFileTool(),
            new SearchCodeTool(),
            new RunCommandTool(),
            new CreateFileTool(),
            new ListFilesTool(),
            new ReadDirectoryTool(),
            new DeleteFileTool(),
            new MoveFileTool(),
            new ApplyDiffTool(),
            new GitOperationTool(),
            new FetchUrlTool(),
        ];
    });

    afterEach(() => {
        cleanupTestWorkspace(workspaceDir);
    });

    it('应该能完成读取文件的任务', async () => {
        const decisions: ModelDecision[] = [
            {
                type: 'Action',
                tool: 'read_file',
                params: { path: 'src/index.ts' },
                thought: '先读取源代码文件',
            },
            {
                type: 'Final',
                answer: '已读取 src/index.ts 的内容，文件包含一个 greet 函数和 main 调用',
                thought: '任务完成',
            },
        ];

        runtime = new AgentRuntime(
            new MockProvider(decisions),
            tools,
            { workspacePath: workspaceDir, maxIterations: 5 }
        );

        const result = await runtime.run('读取 src/index.ts 的内容');

        // 调试：打印完整的结果
        console.log('=== DEBUG ===');
        console.log('stopReason:', JSON.stringify(result.state.stopReason, null, 2));
        console.log('error:', result.state);
        console.log('observations:', JSON.stringify(result.state.observations, null, 2));
        console.log('=============');

        expect(result.state.stopReason?.type).toBe('task_completed');
        expect(result.state.toolCallCount).toBe(1);
        expect(result.state.observations[0]!.result.success).toBe(true);
    });
    it('应该能完成搜索代码的任务', async () => {
        const decisions: ModelDecision[] = [
            {
                type: 'Action',
                tool: 'search_code',
                params: { pattern: 'greet', includeExtensions: ['.ts'] },
                thought: '搜索 greet 函数的定义',
            },
            {
                type: 'Final',
                answer: '已找到 greet 函数定义',
                thought: '任务完成',
            },
        ];

        runtime = new AgentRuntime(
            new MockProvider(decisions),
            tools,
            { workspacePath: workspaceDir, maxIterations: 5 }
        );

        const result = await runtime.run('搜索 greet 函数');

        expect(result.state.stopReason?.type).toBe('task_completed');
        expect(result.state.observations[0]!.result.success).toBe(true);
        const data = result.state.observations[0]!.result.data as any;
        expect(data.matches.length).toBeGreaterThan(0);
    });

    it('应该能完成创建文件的完整流程', async () => {
        const decisions: ModelDecision[] = [
            {
                type: 'Action',
                tool: 'list_files',
                params: { pattern: 'src/' },
                thought: '先查看当前项目结构',
            },
            {
                type: 'Action',
                tool: 'create_file',
                params: { path: 'src/utils.ts', content: 'export function add(a: number, b: number): number {\n  return a + b;\n}' },
                thought: '创建 utils.ts 工具函数文件',
            },
            {
                type: 'Action',
                tool: 'run_command',
                params: { command: 'npx tsc --noEmit src/utils.ts 2>&1 || echo "no tsconfig"' },
                thought: '验证新创建的文件语法正确',
            },
            {
                type: 'Final',
                answer: '已完成：查看了项目结构、创建了 utils.ts、验证了语法',
                thought: '任务完成',
            },
        ];

        runtime = new AgentRuntime(
            new MockProvider(decisions),
            tools,
            { workspacePath: workspaceDir, maxIterations: 10 }
        );

        const result = await runtime.run('在 src 目录下创建一个工具函数文件 utils.ts，包含一个 add 函数');

        expect(result.state.stopReason?.type).toBe('task_completed');
        expect(result.state.toolCallCount).toBe(3);

        // 验证文件确实被创建
        const createdFile = join(workspaceDir, 'src/utils.ts');
        expect(existsSync(createdFile)).toBe(true);
        const content = readFileSync(createdFile, 'utf-8');
        expect(content).toContain('function add');
    });

    it('应该能完成修改文件并提交 Git', async () => {
        const decisions: ModelDecision[] = [
            {
                type: 'Action',
                tool: 'apply_diff',
                params: {
                    path: 'src/index.ts',
                    old_string: 'Hello',
                    new_string: 'Hi',
                },
                thought: '将 Hello 改为 Hi',
            },
            {
                type: 'Action',
                tool: 'git_operation',
                params: { operation: 'add', paths: ['src/index.ts'] },
                thought: '暂存修改',
            },
            {
                type: 'Action',
                tool: 'git_operation',
                params: { operation: 'commit', message: 'feat: update greeting message' },
                thought: '提交修改',
            },
            {
                type: 'Action',
                tool: 'git_operation',
                params: { operation: 'log', limit: 3 },
                thought: '查看提交历史确认',
            },
            {
                type: 'Final',
                answer: '已完成：修改了问候语、提交了 Git 变更',
                thought: '任务完成',
            },
        ];

        runtime = new AgentRuntime(
            new MockProvider(decisions),
            tools,
            { workspacePath: workspaceDir, maxIterations: 10 }
        );

        const result = await runtime.run('将 src/index.ts 中的 Hello 改为 Hi，并提交到 Git');

        for (let i = 0; i < result.state.observations.length; i++) {
            const obs = result.state.observations[i];
        }

        expect(result.state.stopReason?.type).toBe('task_completed');
        expect(result.state.toolCallCount).toBe(4);

        // 验证文件内容
        const content = readFileSync(join(workspaceDir, 'src/index.ts'), 'utf-8');
        expect(content).toContain('Hi');
        expect(content).not.toContain('Hello');

        // 验证 Git 提交
        const logOutput = execSync('git log --oneline', { cwd: workspaceDir, encoding: 'utf-8' });
        expect(logOutput).toContain('update greeting message');
    });
    it('应该能在工具失败时继续执行', async () => {
        const decisions: ModelDecision[] = [
            {
                type: 'Action',
                tool: 'read_file',
                params: { path: 'non_existent_file.ts' },
                thought: '尝试读取不存在的文件',
            },
            {
                type: 'Action',
                tool: 'list_files',
                params: { pattern: 'src/' },
                thought: '文件不存在，先看看有什么文件',
            },
            {
                type: 'Final',
                answer: '目标文件不存在，已列出可用文件供选择',
                thought: '任务完成',
            },
        ];

        runtime = new AgentRuntime(
            new MockProvider(decisions),
            tools,
            { workspacePath: workspaceDir, maxIterations: 5 }
        );

        const result = await runtime.run('读取 non_existent_file.ts');

        expect(result.state.stopReason?.type).toBe('task_completed');
        expect(result.state.toolCallCount).toBe(2);

        // 第一次调用应该失败
        expect(result.state.observations[0]!.result.success).toBe(false);
        // 第二次调用应该成功（Agent 从失败中恢复）
        expect(result.state.observations[1]!.result.success).toBe(true);
    });

    it('应该在达到最大迭代次数时停止', async () => {
        // 构造一个永远不结束的决策序列
        const decisions: ModelDecision[] = [];
        for (let i = 0; i < 10; i++) {
            decisions.push({
                type: 'Action',
                tool: 'list_files',
                params: { pattern: 'src/' },
                thought: `第 ${i + 1} 次查看文件列表`,
            });
        }

        runtime = new AgentRuntime(
            new MockProvider(decisions),
            tools,
            { workspacePath: workspaceDir, maxIterations: 3 }  // 最多 3 次
        );

        const result = await runtime.run('无限循环测试');

        expect(result.state.stopReason?.type).toBe('max_iterations');
        expect(result.state.iterationCount).toBeLessThanOrEqual(3);
    });

    it('应该能处理 Replan 决策', async () => {
        const decisions: ModelDecision[] = [
            {
                type: 'Action',
                tool: 'read_file',
                params: { path: 'non_existent.ts' },
                thought: '尝试读取文件',
            },
            {
                type: 'Replan',
                reason: '文件不存在，需要先查找正确的文件名',
                thought: '需要调整策略',
                newPlan: [
                    {
                        id: '1',
                        description: '列出当前目录下的文件',
                        status: 'pending',
                        dependsOn: [],
                        completionCriteria: '已获取文件列表',
                    },
                    {
                        id: '2',
                        description: '读取正确的文件',
                        status: 'pending',
                        dependsOn: ['step-1'],
                        completionCriteria: '已读取文件内容',
                    },
                ],
            },
            {
                type: 'Action',
                tool: 'list_files',
                params: { pattern: '*' },
                thought: '列出所有文件',
            },
            {
                type: 'Final',
                answer: '已通过重新规划完成任务',
                thought: '任务完成',
            },
        ];

        runtime = new AgentRuntime(
            new MockProvider(decisions),
            tools,
            { workspacePath: workspaceDir, maxIterations: 10 }
        );

        const result = await runtime.run('读取不存在的文件，然后重新规划');

        expect(result.state.stopReason?.type).toBe('task_completed');
        expect(result.state.plan.version).toBe(2);  // 计划被更新过一次
    });


    it('应该在工具连续失败后自动触发 Replan', async () => {
        // 模拟 3 次连续失败的 read_file
        const decisions: ModelDecision[] = [
            {
                type: 'Action',
                tool: 'read_file',
                params: { path: 'non_existent.ts' },
                thought: '尝试读取不存在的文件',
            },
            {
                type: 'Action',
                tool: 'read_file',
                params: { path: 'non_existent.ts' },
                thought: '再试一次',
            },
            {
                type: 'Action',
                tool: 'read_file',
                params: { path: 'non_existent.ts' },
                thought: '再试第三次',
            },
            {
                type: 'Final',
                answer: '文件不存在，放弃',
                thought: '尝试了三次都失败',
            },
        ];

        runtime = new AgentRuntime(
            new MockProvider(decisions),
            tools,
            { workspacePath: workspaceDir, maxIterations: 10 }
        );

        const result = await runtime.run('读取 non_existent.ts');
        expect(result.state.stopReason?.type).toBe('error');
        if (result.state.stopReason?.type === 'error') {
            expect(result.state.stopReason.message).toContain('连续失败');
        }
        expect(result.state.iterationCount).toBeLessThanOrEqual(4);
    });


    it('应该能并行执行多个独立工具调用', async () => {
        const decisions: ModelDecision[] = [
            {
                type: 'BatchAction',
                thought: '同时读取多个文件',
                actions: [
                    {
                        tool: 'read_file',
                        params: { path: 'src/index.ts' },
                        thought: '读取主文件',
                    },
                    {
                        tool: 'read_file',
                        params: { path: 'package.json' },
                        thought: '读取配置文件',
                    },
                ],
            },
            {
                type: 'Final',
                answer: '已完成并行读取',
                thought: '任务完成',
            },
        ];

        runtime = new AgentRuntime(
            new MockProvider(decisions),
            tools,
            { workspacePath: workspaceDir, maxIterations: 5 }
        );

        const result = await runtime.run('同时读取 src/index.ts 和 package.json');

        expect(result.state.stopReason?.type).toBe('task_completed');
        expect(result.state.toolCallCount).toBe(2);
        expect(result.state.observations.length).toBe(2);
        expect(result.state.observations[0]!.result.success).toBe(true);
        expect(result.state.observations[1]!.result.success).toBe(true);
    });

    it('应该遵守最大并发数限制', async () => {
        let concurrentCount = 0;
        let maxObservedConcurrent = 0;

        // 用一个自定义工具来跟踪并发数
        class DelayTool implements Tool<ToolParams> {
            name = 'delay_tool';
            description = '延迟指定毫秒后返回';
            permissions = { readsFiles: false, writesFiles: false, runsShell: false, requiresApproval: false };
            getSchema() { return { type: 'object', properties: {}, required: [] }; }
            validate(params: unknown) { return { valid: true, errors: [], sanitized: {} as ToolParams }; }
            async execute(_params: ToolParams, _ctx: ToolContext): Promise<ToolResult> {
                concurrentCount++;
                maxObservedConcurrent = Math.max(maxObservedConcurrent, concurrentCount);
                await new Promise(resolve => setTimeout(resolve, 100));  // 每个任务耗时 100ms
                concurrentCount--;
                return { success: true, data: null, error: '' };
            }
        }

        const decisions: ModelDecision[] = [
            {
                type: 'BatchAction',
                thought: '同时执行多个延迟任务',
                actions: [
                    { tool: 'delay_tool', params: {} },
                    { tool: 'delay_tool', params: {} },
                    { tool: 'delay_tool', params: {} },
                    { tool: 'delay_tool', params: {} },
                    { tool: 'delay_tool', params: {} },
                ],
            },
            {
                type: 'Final',
                answer: '完成',
                thought: '任务完成',
            },
        ];

        runtime = new AgentRuntime(
            new MockProvider(decisions),
            [new DelayTool()],
            { workspacePath: workspaceDir, maxIterations: 5, maxConcurrency: 2 }
        );

        const result = await runtime.run('执行多个延迟任务');

        expect(result.state.stopReason?.type).toBe('task_completed');
        expect(result.state.toolCallCount).toBe(5);
        // 并发度是直接信号：5 个任务、上限 2，运行过程中必须真的同时到过 2 个。
        // 这里原先是断言 run() 的墙钟上界（elapsed < 400ms），但 run() 结束时会
        // 真实执行验收命令（npm test），耗时不再只反映批量并发，该代理指标已失效。
        expect(maxObservedConcurrent).toBe(2);
    });
});