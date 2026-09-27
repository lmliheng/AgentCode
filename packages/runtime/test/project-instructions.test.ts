// 工作区指令文件：给用户一个「本项目的规矩」注入点。
//
// 在此之前系统提示是代码里拼死的固定文本，一条项目约定只能在每条任务里重复声明。

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    MAX_PROJECT_INSTRUCTION_CHARS,
    formatProjectInstructions,
    loadProjectInstructions,
} from '../src/project-instructions.js';
import { AgentRuntime } from '../src/agent.runtime.js';
import { ReadFileTool } from '@lmliheng/acode-tools';
import { createTestWorkspace, cleanupTestWorkspace, initialPlanDecision } from './setup.js';
import type {
    AgentProvider,
    AgentProviderConfig,
    ChatMessage,
    ModelDecision,
    ModelResponse,
} from '@lmliheng/acode-core';

const dirs: string[] = [];

function workspace(files: Record<string, string>): string {
    const dir = createTestWorkspace(files);
    dirs.push(dir);
    return dir;
}

afterEach(() => {
    while (dirs.length > 0) {
        cleanupTestWorkspace(dirs.pop()!);
    }
});

describe('工作区指令文件', () => {
    it('没有指令文件时返回 null', () => {
        expect(loadProjectInstructions(workspace({ 'index.ts': '' }))).toBeNull();
    });

    it('读到内容并去掉首尾空白', () => {
        const dir = workspace({ 'ACODE.md': '\n  本项目用中文提交信息  \n\n' });

        const loaded = loadProjectInstructions(dir);

        expect(loaded).not.toBeNull();
        expect(loaded!.file).toBe('ACODE.md');
        expect(loaded!.path).toBe(join(dir, 'ACODE.md'));
        expect(loaded!.content).toBe('本项目用中文提交信息');
        expect(loaded!.truncated).toBe(false);
    });

    it('多份同时存在时只认优先级最高的那份', () => {
        const dir = workspace({
            'AGENTS.md': '来自 AGENTS',
            'CLAUDE.md': '来自 CLAUDE',
            'ACODE.md': '来自 ACODE',
        });

        expect(loadProjectInstructions(dir)!.file).toBe('ACODE.md');
    });

    it('空文件按「没有」处理，并继续看下一份', () => {
        const dir = workspace({ 'ACODE.md': '   \n', 'AGENTS.md': '来自 AGENTS' });

        expect(loadProjectInstructions(dir)!.file).toBe('AGENTS.md');
    });

    it('同名目录不算指令文件', () => {
        const dir = workspace({ 'other.txt': '' });
        mkdirSync(join(dir, 'ACODE.md'));

        expect(loadProjectInstructions(dir)).toBeNull();
    });

    it('超长内容截断并标记，不把整个文件塞进每次请求', () => {
        const dir = workspace({ 'AGENTS.md': 'A'.repeat(MAX_PROJECT_INSTRUCTION_CHARS + 500) });

        const loaded = loadProjectInstructions(dir)!;

        expect(loaded.truncated).toBe(true);
        expect(loaded.content.length).toBe(MAX_PROJECT_INSTRUCTION_CHARS);
    });

    it('渲染出来的段落说明来路、内容与截断情况', () => {
        const text = formatProjectInstructions({
            file: 'ACODE.md',
            path: '/ws/ACODE.md',
            content: '提交信息用中文',
            truncated: true,
        });

        expect(text).toContain('ACODE.md');
        expect(text).toContain('/ws/ACODE.md');
        expect(text).toContain('提交信息用中文');
        expect(text).toContain('截断');
        // 与通用工作方式冲突时的裁决顺序要写出来
        expect(text).toContain('优先');
    });
});

/**
 * 记下每次请求的消息，用于断言系统提示的内容。
 *
 * `onDecide` 让用例能在「某一次请求之前」制造外部变化（改文件），
 * 用来钉住「指令只读一次」这条约束。
 */
class RecordingProvider implements AgentProvider {
    readonly name = 'recording';
    config: AgentProviderConfig = { modelName: 'recording', temperature: 0, maxTokens: 100 };
    readonly requests: ChatMessage[][] = [];
    private index = 0;
    private readonly decisions: ModelDecision[];

    constructor(decisions: ModelDecision[], private readonly onDecide?: (callIndex: number) => void) {
        this.decisions = decisions;
    }

    updateConfig(): void {
        // 测试用
    }

    async decide(messages: ChatMessage[]): Promise<ModelResponse> {
        this.requests.push([...messages]);
        this.onDecide?.(this.requests.length);
        const decision = this.decisions[this.index] ?? { type: 'Final' as const, answer: '结束' };
        this.index += 1;
        return { decision, rawContent: '' };
    }
}

describe('工作区指令进入系统提示', () => {
    it('每轮请求的 system 消息都带着工作区指令', async () => {
        const dir = workspace({
            'ACODE.md': '本项目：提交信息用中文，测试用 vitest。',
            'src/a.ts': 'export const a = 1;\n',
        });
        const provider = new RecordingProvider([
            initialPlanDecision(),
            { type: 'Final', answer: '完成' },
        ]);

        await new AgentRuntime(provider, [new ReadFileTool()], {
            workspacePath: dir,
            maxIterations: 5,
        } as never).run('看看效果');

        // 第 1 次请求是规划轮（独立提示词），之后的循环轮都要带上工作区指令
        expect(provider.requests.length).toBeGreaterThanOrEqual(2);
        for (const messages of provider.requests.slice(1)) {
            expect(messages[0]!.role).toBe('system');
            expect(messages[0]!.content).toContain('提交信息用中文，测试用 vitest。');
            expect(messages[0]!.content).toContain('ACODE.md');
        }
    });

    it('没有指令文件时系统提示与本来的样子一致（不留下空段落）', async () => {
        const dir = workspace({ 'src/a.ts': 'export const a = 1;\n' });
        const provider = new RecordingProvider([
            initialPlanDecision(),
            { type: 'Final', answer: '完成' },
        ]);

        await new AgentRuntime(provider, [new ReadFileTool()], {
            workspacePath: dir,
            maxIterations: 5,
        } as never).run('看看效果');

        const system = provider.requests[1]![0]!.content;
        expect(system).not.toContain('工作区指令');
        expect(system).toContain('你是一个 AI 编码助手');
    });

    it('运行中途改文件不影响本次运行（前缀一变，缓存全失效）', async () => {
        const dir = workspace({ 'ACODE.md': '第一版规矩' });
        const provider = new RecordingProvider(
            [initialPlanDecision(), { type: 'Action', tool: 'read_file', params: { path: 'ACODE.md' } }, { type: 'Final', answer: '完成' }],
            // 第 2 次请求（循环第一轮）之后、第 3 次之前改文件
            (callIndex) => {
                if (callIndex === 2) writeFileSync(join(dir, 'ACODE.md'), '第二版规矩', 'utf-8');
            },
        );

        await new AgentRuntime(provider, [new ReadFileTool()], {
            workspacePath: dir,
            maxIterations: 5,
        } as never).run('看看效果');

        expect(provider.requests.length).toBeGreaterThanOrEqual(3);
        const later = provider.requests[2]![0]!.content;
        expect(later).toContain('第一版规矩');
        expect(later).not.toContain('第二版规矩');
    });
});
