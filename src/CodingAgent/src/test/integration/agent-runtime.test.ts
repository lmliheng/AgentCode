import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentRuntime } from '../../runtime/agent.runtime.js';
import { ReadFileTool } from '../../tools/read_file.js';
import { EditFileTool } from '../../tools/edit_file.js';
import { SearchCodeTool } from '../../tools/search_code.js';
import { createTestWorkspace, cleanupTestWorkspace, initialPlanResponse } from '../setup.js';
import type { AgentProvider, ModelResponse, AgentProviderConfig } from '../../types/AgentProvider.js';
import type { ChatMessage } from '../../types/Message.js';
import type { ModelDecision } from '../../types/ReAct.js';

/**
 * Mock Provider：模拟模型行为
 * 返回 ModelResponse 而非 ModelDecision
 */
class MockProvider implements AgentProvider {
    name = 'mock';
    config: AgentProviderConfig = {
        apiKey: 'mock-key',
        modelName: 'mock-model',
        temperature: 0,
        maxTokens: 4096,
    };

    private responses: ModelResponse[] = [];
    private callIndex = 0;

    constructor(responses: ModelResponse[]) {
        // 队列第一位留给规划轮：运行时进入循环前会先请求一次初始计划
        this.responses = [initialPlanResponse(), ...responses];
    }

    async decide(messages: ChatMessage[], tools: any[]): Promise<ModelResponse> {
        const response = this.responses[this.callIndex];
        if (!response) {
            return {
                decision: {
                    type: 'Final',
                    thought: '任务完成',
                    answer: '完成',
                },
                rawContent: JSON.stringify({
                    type: 'Final',
                    thought: '任务完成',
                    answer: '完成',
                }),
            };
        }
        this.callIndex++;
        return response;
    }

    formatMessage(msg: ChatMessage): any {
        return msg;
    }

    updateConfig(config: Partial<typeof this.config>): void {
        Object.assign(this.config, config);
    }

}

/**
 * 辅助函数：将 ModelDecision 包装为 ModelResponse
 */
function wrapDecision(decision: ModelDecision): ModelResponse {
    return {
        decision,
        rawContent: JSON.stringify(decision),
    };
}

describe('AgentRuntime Integration', () => {
    let workspaceDir: string;
    let runtime: AgentRuntime;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({
            'src/greet.ts': `
export function greet(name: string): string {
    return \`Hello, \${name}!\`;
}
`.trim(),
            'src/index.ts': `
import { greet } from './greet.js';

console.log(greet('World'));
`.trim(),
        });
    });

    afterEach(() => {
        cleanupTestWorkspace(workspaceDir);
    });

    it('应该能完成一次完整的读文件→改文件→验证流程', async () => {
        const responses: ModelResponse[] = [
            wrapDecision({
                type: 'Action',
                thought: '先读取 greet.ts 文件，了解当前代码',
                tool: 'read_file',
                params: { path: 'src/greet.ts' },
            }),
            wrapDecision({
                type: 'Action',
                thought: '需要增加空值保护，替换 return 语句',
                tool: 'edit_file',
                params: {
                    path: 'src/greet.ts',
                    old_string: 'return \\`Hello, \\${name}!\\`',
                    new_string: 'return \\`Hello, \\${name ?? "Guest"}!\\`',
                },
            }),
            wrapDecision({
                type: 'Action',
                thought: '验证修改后的文件',
                tool: 'read_file',
                params: { path: 'src/greet.ts' },
            }),
            wrapDecision({
                type: 'Final',
                thought: '修改完成，代码已增加空值保护',
                answer: '已完成 greet.ts 的空值保护改造',
            }),
        ];

        const mockProvider = new MockProvider(responses);
        runtime = new AgentRuntime(
            mockProvider,
            [new ReadFileTool(), new EditFileTool(), new SearchCodeTool()],
            {
                workspacePath: workspaceDir,
                maxIterations: 10,
            }
        );

        const result = await runtime.run('给 greet 函数增加空值保护');

        // 验证结果 - 注意属性路径
        expect(result.state.stopReason?.type).toBe('task_completed');
        expect(result.state.decisions.length).toBe(4); // 3 次 Action + 1 次 Final
        expect(result.state.toolCallCount).toBe(3);

        // 验证最终答案
        const finalDecision = result.state.decisions[result.state.decisions.length - 1];
        expect(finalDecision!.type).toBe('Final');
        expect((finalDecision as any).answer).toBe('已完成 greet.ts 的空值保护改造');
    });

    it('应该在工具调用失败时让模型重试', async () => {
        const responses: ModelResponse[] = [
            wrapDecision({
                type: 'Action',
                thought: '尝试修改，但故意传错 old_string',
                tool: 'edit_file',
                params: {
                    path: 'src/greet.ts',
                    old_string: '不存在的字符串',
                    new_string: 'xxx',
                },
            }),
            wrapDecision({
                type: 'Action',
                thought: '第一次失败了，重新读取文件确认内容',
                tool: 'read_file',
                params: { path: 'src/greet.ts' },
            }),
            wrapDecision({
                type: 'Action',
                thought: '这次用正确的 old_string',
                tool: 'edit_file',
                params: {
                    path: 'src/greet.ts',
                    old_string: 'return \\`Hello, \\${name}!\\`',
                    new_string: 'return \\`Hello, \\${name ?? "Guest"}!\\`',
                },
            }),
            wrapDecision({
                type: 'Final',
                thought: '修改成功',
                answer: '完成',
            }),
        ];

        const mockProvider = new MockProvider(responses);
        runtime = new AgentRuntime(
            mockProvider,
            [new ReadFileTool(), new EditFileTool(), new SearchCodeTool()],
            {
                workspacePath: workspaceDir,
                maxIterations: 10,
            }
        );

        const result = await runtime.run('给 greet 函数增加空值保护');

        expect(result.state.stopReason?.type).toBe('task_completed');
        expect(result.state.decisions.length).toBe(4);
        expect(result.state.toolCallCount).toBe(3);
    });

    it('应该能在达到最大迭代次数时停止', async () => {
        const responses: ModelResponse[] = [
            wrapDecision({
                type: 'Action',
                thought: '一直读文件',
                tool: 'read_file',
                params: { path: 'src/greet.ts' },
            }),
            wrapDecision({
                type: 'Action',
                thought: '一直读文件',
                tool: 'read_file',
                params: { path: 'src/index.ts' },
            }),
            wrapDecision({
                type: 'Action',
                thought: '一直读文件',
                tool: 'read_file',
                params: { path: 'src/greet.ts' },
            }),
            wrapDecision({
                type: 'Action',
                thought: '一直读文件',
                tool: 'read_file',
                params: { path: 'src/index.ts' },
            }),
            wrapDecision({
                type: 'Action',
                thought: '一直读文件',
                tool: 'read_file',
                params: { path: 'src/greet.ts' },
            }),
        ];

        const mockProvider = new MockProvider(responses);
        runtime = new AgentRuntime(
            mockProvider,
            [new ReadFileTool(), new EditFileTool(), new SearchCodeTool()],
            {
                workspacePath: workspaceDir,
                maxIterations: 3,
            }
        );

        const result = await runtime.run('测试迭代上限');

        expect(result.state.stopReason?.type).toBe('max_iterations');
        expect(result.state.iterationCount).toBe(3);
    });
});