
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SearchCodeTool } from '../../tools/search_code.js';
import { createTestWorkspace, cleanupTestWorkspace } from '../setup.js';
import type { ToolContext } from '../../types/Tool.js';

describe('SearchCodeTool', () => {
    let workspaceDir: string;
    let tool: SearchCodeTool;
    let ctx: ToolContext;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({
            'src/main.ts': `
function greet(name: string) {
    return \`Hello, \${name}!\`;
}

function add(a: number, b: number) {
    return a + b;
}
`.trim(),
            'src/utils.ts': `
export function formatDate(date: Date) {
    return date.toISOString();
}

export function parseNumber(str: string) {
    return parseInt(str, 10);
}
`.trim(),
            'README.md': '# Hello World\nThis is a test project.',
        });
        tool = new SearchCodeTool();
        ctx = {
            workspaceRoot: workspaceDir,
            allowedPaths: [workspaceDir],
            runId: 'test-run-001',
            requestApproval: async () => 'approve',
        };
    });

    afterEach(() => {
        cleanupTestWorkspace(workspaceDir);
    });

    describe('validate', () => {
        it('应该接受合法的参数', () => {
            const result = tool.validate({ pattern: 'function' });
            expect(result.valid).toBe(true);
        });

        it('应该拒绝空的 pattern', () => {
            const result = tool.validate({ pattern: '' });
            expect(result.valid).toBe(false);
        });

        it('应该设置默认值', () => {
            const result = tool.validate({ pattern: 'test' }) as any;
            expect(result.sanitized.maxResults).toBe(50);
            expect(result.sanitized.caseSensitive).toBe(false);
            expect(result.sanitized.contextLines).toBe(0);
        });
    });

    describe('execute', () => {
        it('应该搜索到匹配的函数定义', async () => {
            const result = await tool.execute({ pattern: 'function' }, ctx);
            expect(result.success).toBe(true);
            expect((result.data as any).matches).toHaveLength(4); // 4 个 function
        });

        it('应该支持大小写敏感搜索', async () => {
            const result = await tool.execute({
                pattern: 'Function',
                caseSensitive: true
            }, ctx);
            expect(result.success).toBe(true);
            expect((result.data as any).matches).toHaveLength(0); // 找不到 Function
        });

        it('应该只搜索 .ts 文件', async () => {
            const result = await tool.execute({
                pattern: 'test project',  // 只在 README.md 中出现
                include: ['.ts']
            }, ctx);
            expect(result.success).toBe(true);
            expect((result.data as any).matches).toHaveLength(0); // .ts 文件中没有 "test project"
        });

        it('应该返回上下文行', async () => {
            const result = await tool.execute({
                pattern: 'formatDate',  // 在 utils.ts 的第二行，前后都有内容
                contextLines: 1
            }, ctx);
            expect(result.success).toBe(true);
            const match = (result.data as any).matches[0];
            expect(match.context).toBeDefined();
            expect(match.context.before.length + match.context.after.length).toBeGreaterThan(0);
        });

        it('应该限制返回结果数量', async () => {
            const result = await tool.execute({
                pattern: 'function',
                maxResults: 2
            }, ctx);
            expect(result.success).toBe(true);
            expect((result.data as any).matches).toHaveLength(2);
            expect((result.data as any).truncated).toBe(true);
        });
    });

    describe('display（执行摘要）', () => {
        it('摘要报出模式与匹配数', async () => {
            const result = await tool.execute({ pattern: 'function' }, ctx);
            expect(result.display).toBe('function 匹配 4 处');
        });

        it('没有匹配时如实报 0 处', async () => {
            const result = await tool.execute({ pattern: '找不到的词' }, ctx);
            expect(result.display).toBe('找不到的词 匹配 0 处');
        });

        it('达到 maxResults 时标注可能未列全', async () => {
            const result = await tool.execute({ pattern: 'function', maxResults: 2 }, ctx);
            expect(result.display).toBe('function 匹配 2 处（已达上限，可能未列全）');
        });
    });
});