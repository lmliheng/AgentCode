// src/test/runtime/deferred-tools.test.ts
//
// 覆盖常驻 / 延迟工具的划分与桥工具：
//   - 白名单决定「声明哪些」，但延迟工具仍可执行
//   - tool_search 只回传 schema 文本，不改动声明列表
//   - tool_call 在派发层解包，且回填给模型的消息名仍是 tool_call
//     （这两件事必须分开：解包用真实工具名，消息里必须是模型原样发出的名字）
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { AgentRuntime } from '../../runtime/agent.runtime.js';
import { ToolRegistry } from '../../tools/ToolRegistry.js';
import { ToolSearchTool } from '../../tools/tool_search.js';
import { ToolCallTool, resolveDeferredToolCall } from '../../tools/tool_call.js';
import { splitDeclaredTools, TOOL_CALL, TOOL_SEARCH } from '../../tools/deferred.js';
import { ReadFileTool } from '../../tools/read_file.js';
import { MoveFileTool } from '../../tools/move_file.js';
import { config } from '../../config/default.js';

import { createTestWorkspace, cleanupTestWorkspace, initialPlanDecision } from '../setup.js';
import type {
    AgentProvider,
    AgentProviderConfig,
    ModelResponse,
    ToolDefinition,
} from '../../types/AgentProvider.js';
import type { ChatMessage, AssistantMessage, ToolMessage } from '../../types/Message.js';
import type { ModelDecision } from '../../types/ReAct.js';
import type { Tool } from '../../types/Tool.js';

/** 记录每次请求收到的消息与工具声明，并按脚本逐轮返回决策 */
class CapturingProvider implements AgentProvider {
    readonly name = 'capturing';
    config: AgentProviderConfig = { modelName: 'capturing', temperature: 0, maxTokens: 100 };
    readonly seen: Array<{ messages: ChatMessage[]; tools: ToolDefinition[] }> = [];

    private readonly script: ModelDecision[];
    private index = 0;

    constructor(script: ModelDecision[]) {
        // 脚本第一位留给规划轮
        this.script = [initialPlanDecision(), ...script];
    }

    updateConfig(): void {
        // 测试用，无需实现
    }

    async decide(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ModelResponse> {
        this.seen.push({ messages, tools });
        const decision = this.script[this.index] ?? { type: 'Final', answer: '结束' };
        this.index += 1;
        return { decision, rawContent: '' };
    }
}

function fakeSource(tools: Tool[]): { getDeferredTools(): Tool[] } {
    return { getDeferredTools: () => tools };
}

describe('常驻 / 延迟划分', () => {
    it('未给白名单时不限制，全部常驻', () => {
        const tools = [new ReadFileTool(), new MoveFileTool()];
        const split = splitDeclaredTools(tools, undefined);

        expect(split.eager.map((t) => t.name)).toEqual(['read_file', 'move_file']);
        expect(split.deferred).toEqual([]);
        expect(split.unknownNames).toEqual([]);
    });

    it('给了白名单就切分，未列出的转延迟', () => {
        const tools = [new ReadFileTool(), new MoveFileTool()];
        const split = splitDeclaredTools(tools, ['read_file']);

        expect(split.eager.map((t) => t.name)).toEqual(['read_file']);
        expect(split.deferred.map((t) => t.name)).toEqual(['move_file']);
    });

    it('空数组是有效配置：全部延迟', () => {
        const tools = [new ReadFileTool(), new MoveFileTool()];
        const split = splitDeclaredTools(tools, []);

        expect(split.eager).toEqual([]);
        expect(split.deferred.map((t) => t.name)).toEqual(['read_file', 'move_file']);
    });

    it('桥工具豁免白名单，永远常驻', () => {
        const tools = [new ReadFileTool(), new ToolCallTool(), new ToolSearchTool(fakeSource([]))];
        const split = splitDeclaredTools(tools, ['read_file']);

        // 顺序沿用输入顺序（声明顺序会随请求下发，不能被切分打乱）
        expect(split.eager.map((t) => t.name)).toEqual(['read_file', TOOL_CALL, TOOL_SEARCH]);
        expect(split.deferred).toEqual([]);
    });

    it('白名单里拼错的名字被报出来，而不是静默忽略', () => {
        const split = splitDeclaredTools([new ReadFileTool()], ['read_file', 'read_fiel']);

        expect(split.unknownNames).toEqual(['read_fiel']);
    });
});

describe('ToolRegistry 与白名单', () => {
    it('createDefault 注册桥工具，并按白名单切分', () => {
        const registry = ToolRegistry.createDefault(['read_file', 'edit_file']);

        const eager = registry.getEagerTools().map((t) => t.name);
        expect(eager).toContain('read_file');
        expect(eager).toContain('edit_file');
        expect(eager).toContain(TOOL_SEARCH);
        expect(eager).toContain(TOOL_CALL);

        const deferred = registry.getDeferredTools().map((t) => t.name);
        expect(deferred).toContain('git_operation');
        expect(deferred).not.toContain('read_file');
        // 桥工具不是延迟工具
        expect(deferred).not.toContain(TOOL_SEARCH);
        expect(deferred).not.toContain(TOOL_CALL);
    });

    it('延迟工具仍然注册、仍然可取到（否则无从执行）', () => {
        const registry = ToolRegistry.createDefault(['read_file']);

        expect(registry.getTool('git_operation')).toBeDefined();
        expect(registry.getAllToolNames()).toContain('git_operation');
    });

    it('白名单里的无效名字会让启动直接失败', () => {
        expect(() => ToolRegistry.createDefault(['read_file', 'no_such_tool'])).toThrow(
            /no_such_tool/,
        );
    });

    it('默认配置本身是自洽的：名字都存在，且桥在常驻集里', () => {
        const registry = ToolRegistry.createDefault(config.tools.eager);
        expect(registry.getUnknownEagerNames()).toEqual([]);

        const eager = registry.getEagerTools().map((t) => t.name);
        expect(eager).toContain(TOOL_SEARCH);
        expect(eager).toContain(TOOL_CALL);
        // 白名单生效：确实存在被延迟的工具
        expect(registry.getDeferredTools().length).toBeGreaterThan(0);
    });
});

describe('tool_search', () => {
    const deferred = [new MoveFileTool()];

    it('select: 精确取回 schema 文本', async () => {
        const tool = new ToolSearchTool(fakeSource(deferred));
        const result = await tool.execute({ query: 'select:move_file' }, {} as never);

        expect(result.success).toBe(true);
        const text = (result.data as any).text as string;
        expect(text).toContain('<functions>');
        expect(text).toContain('move_file');
        expect(text).toContain('source');
    });

    it('关键词能按名字命中', async () => {
        const tool = new ToolSearchTool(fakeSource(deferred));
        const result = await tool.execute({ query: 'move' }, {} as never);

        expect((result.data as any).reviewed).toEqual(['move_file']);
    });

    it('搜不到时明确回报，而不是返回空块', async () => {
        const tool = new ToolSearchTool(fakeSource(deferred));
        const result = await tool.execute({ query: 'select:edit_file' }, {} as never);

        expect((result.data as any).reviewed).toEqual([]);
        expect((result.data as any).notFound).toEqual(['edit_file']);
        expect((result.data as any).text).toContain('Not found');
    });

    it('max_results 截断时回显剩下的名字', async () => {
        const tool = new ToolSearchTool(fakeSource([new MoveFileTool(), new ReadFileTool()]));
        const result = await tool.execute({ query: 'e', max_results: 1 }, {} as never);

        const data = result.data as any;
        expect(data.reviewed.length).toBe(1);
        expect(data.truncated.length).toBe(1);
        expect(data.text).toContain('截断');
    });

    it('桥工具自己不能被搜出（它们本来就是声明的）', async () => {
        const tool = new ToolSearchTool(fakeSource([new ToolCallTool()]));
        const result = await tool.execute({ query: 'select:tool_call' }, {} as never);

        expect((result.data as any).reviewed).toEqual([]);
    });

    it('validate 拒绝空 query 与越界 max_results', () => {
        const tool = new ToolSearchTool(fakeSource(deferred));

        expect(tool.validate({ query: '  ' }).valid).toBe(false);
        expect(tool.validate({ query: 'a', max_results: 0 }).valid).toBe(false);
        expect(tool.validate({ query: 'a', max_results: 999 }).valid).toBe(false);
        expect(tool.validate({ query: 'a' }).valid).toBe(true);
    });
});

describe('tool_call 信封', () => {
    it('validate 要求 arguments 是对象，并禁止把桥工具当目标', () => {
        const tool = new ToolCallTool();

        expect(tool.validate({ name: 'move_file', arguments: {} }).valid).toBe(true);
        expect(tool.validate({ name: 'move_file' }).valid).toBe(false);
        expect(tool.validate({ name: 'move_file', arguments: 42 }).valid).toBe(false);
        expect(tool.validate({ name: TOOL_CALL, arguments: {} }).valid).toBe(false);
    });

    it('execute 拒绝直接执行，指明必须经运行时派发', async () => {
        const tool = new ToolCallTool();
        const result = await tool.execute({ name: 'move_file', arguments: {} }, {} as never);

        expect(result.success).toBe(false);
        expect(result.error).toContain('AgentRuntime');
    });

    it('resolveDeferredToolCall 解析出目标调用', () => {
        const tools = new Map<string, Tool>([['move_file', new MoveFileTool()]]);
        const resolution = resolveDeferredToolCall(
            { name: 'move_file', arguments: { source: 'a', destination: 'b' } },
            tools,
        );

        expect(resolution).toEqual({
            ok: true,
            toolName: 'move_file',
            params: { source: 'a', destination: 'b' },
        });
    });

    it('名字大小写不敏感', () => {
        const tools = new Map<string, Tool>([['move_file', new MoveFileTool()]]);
        const resolution = resolveDeferredToolCall({ name: 'MOVE_FILE', arguments: {} }, tools);

        expect(resolution.ok && resolution.toolName).toBe('move_file');
    });

    it('拒绝未知工具、非对象 arguments、以及套娃', () => {
        const tools = new Map<string, Tool>([['move_file', new MoveFileTool()]]);

        expect(resolveDeferredToolCall({ name: 'nope', arguments: {} }, tools).ok).toBe(false);
        expect(resolveDeferredToolCall({ name: 'move_file', arguments: 7 }, tools).ok).toBe(false);
        expect(resolveDeferredToolCall({ name: TOOL_CALL, arguments: {} }, tools).ok).toBe(false);
    });
});

describe('运行时：声明集与桥解包', () => {
    let workspaceDir: string;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({
            'src/a.ts': 'export const a = 1;\n',
            'src/b.ts': 'export const b = 2;\n',
        });
    });

    afterEach(() => {
        cleanupTestWorkspace(workspaceDir);
    });

    const allowList = ['read_file', 'list_files'];

    function runtimeFor(
        provider: AgentProvider,
        registry: ToolRegistry,
    ): AgentRuntime {
        return new AgentRuntime(provider, registry.getAllTools(), {
            workspacePath: workspaceDir,
            maxIterations: 5,
            timeoutMs: 5000,
            eagerTools: allowList,
        });
    }

    it('只下发常驻集 + 桥工具；延迟工具的声明不进请求', async () => {
        const provider = new CapturingProvider([{ type: 'Final', answer: '完成' }]);
        const registry = ToolRegistry.createDefault(allowList);

        await runtimeFor(provider, registry).run('随便走一轮');

        const first = provider.seen[0]!;
        const declared = first.tools.map((t) => t.name);
        expect(declared).toEqual(['read_file', 'list_files', TOOL_SEARCH, TOOL_CALL]);
        // 延迟工具的 schema 一个都不在
        expect(declared).not.toContain('git_operation');
        expect(declared).not.toContain('move_file');
    });

    it('系统提示里列出延迟工具的名字，桥齐备时才有', async () => {
        const provider = new CapturingProvider([{ type: 'Final', answer: '完成' }]);
        const registry = ToolRegistry.createDefault(allowList);

        await runtimeFor(provider, registry).run('随便走一轮');

        // 第一次请求是规划轮（用 PLANNING_SYSTEM_PROMPT），延迟清单在主循环的系统提示里
        const messages = provider.seen[provider.seen.length - 1]!.messages;
        const system = messages.find((m) => m.role === 'system');
        const content = typeof system?.content === 'string' ? system.content : '';
        expect(content).toContain('以下工具不在你的工具列表里');
        expect(content).toContain('tool_search');
        expect(content).toContain('git_operation');
    });

    it('桥不全时不广告延迟工具（广告了也够不到）', async () => {
        // 只给业务工具与 tool_search，缺 tool_call
        const tools = [new ReadFileTool(), new ToolSearchTool(fakeSource([]))];
        const provider = new CapturingProvider([{ type: 'Final', answer: '完成' }]);
        const runtime = new AgentRuntime(provider, tools, {
            workspacePath: workspaceDir,
            maxIterations: 5,
            timeoutMs: 5000,
            eagerTools: ['read_file'],
        });

        await runtime.run('随便走一轮');

        const messages = provider.seen[provider.seen.length - 1]!.messages;
        const system = messages.find((m) => m.role === 'system');
        const content = typeof system?.content === 'string' ? system.content : '';
        expect(content).not.toContain('以下工具不在你的工具列表里');
    });

    it('tool_call 解包后执行真实工具，观察记录用真实工具名', async () => {
        const provider = new CapturingProvider([
            {
                type: 'Action',
                tool: TOOL_CALL,
                params: { name: 'read_directory', arguments: { path: 'src' } },
                thought: '看目录结构',
                toolCallId: 'call_bridge_1',
            },
            { type: 'Final', answer: '完成' },
        ]);
        const registry = ToolRegistry.createDefault(allowList);

        const result = await runtimeFor(provider, registry).run('看目录');

        expect(result.state.observations.length).toBe(1);
        const observation = result.state.observations[0]!;
        // 观察记录真实工具，而不是笼统的 tool_call
        expect(observation.action.tool).toBe('read_directory');
        expect(observation.result.success).toBe(true);
    });

    it('回填给模型的消息名保持 tool_call，与 tool_call_id 成对', async () => {
        const provider = new CapturingProvider([
            {
                type: 'Action',
                tool: TOOL_CALL,
                params: { name: 'read_directory', arguments: {} },
                thought: '看目录结构',
                toolCallId: 'call_bridge_2',
            },
            { type: 'Final', answer: '完成' },
        ]);
        const registry = ToolRegistry.createDefault(allowList);

        await runtimeFor(provider, registry).run('看目录');

        const messages = provider.seen[provider.seen.length - 1]!.messages;
        const assistant = messages.find(
            (m): m is AssistantMessage => m.role === 'assistant' && (m.tool_calls?.length ?? 0) > 0,
        );
        const toolMessage = messages.find((m): m is ToolMessage => m.role === 'tool');

        expect(assistant?.tool_calls?.[0]?.function.name).toBe(TOOL_CALL);
        expect(toolMessage?.name).toBe(TOOL_CALL);
        expect(toolMessage?.tool_call_id).toBe('call_bridge_2');
    });

    it('延迟工具产生的文件变更按真实工具名记账', async () => {
        const provider = new CapturingProvider([
            {
                type: 'Action',
                tool: TOOL_CALL,
                params: {
                    name: 'move_file',
                    arguments: { source: 'src/a.ts', destination: 'src/c.ts' },
                },
                thought: '改名',
            },
            { type: 'Final', answer: '完成' },
        ]);
        const registry = ToolRegistry.createDefault(allowList);

        const result = await runtimeFor(provider, registry).run('移动文件');

        // move_file 在 MODIFYING_TOOLS 里；若拿 tool_call 去比就会漏记
        expect(result.state.fileChanges.some((c) => c.tool === 'move_file')).toBe(true);
    });

    it('tool_call 指向未知工具时记为失败观察，不中断运行', async () => {
        const provider = new CapturingProvider([
            {
                type: 'Action',
                tool: TOOL_CALL,
                params: { name: 'no_such_tool', arguments: {} },
                thought: '乱指一个',
            },
            { type: 'Final', answer: '完成' },
        ]);
        const registry = ToolRegistry.createDefault(allowList);

        const result = await runtimeFor(provider, registry).run('乱指');

        expect(result.state.stopReason).toEqual({ type: 'task_completed' });
        expect(result.state.observations[0]!.result.success).toBe(false);
        expect(result.state.observations[0]!.result.error).toContain('未知的工具');
    });
});
