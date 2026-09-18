import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ReadFileTool } from '../../tools/read_file.js';
import { createTestWorkspace, cleanupTestWorkspace } from '../setup.js';
import type { ToolContext } from '../../types/Tool.js';

describe('ReadFileTool', () => {
    let workspaceDir: string;
    let tool: ReadFileTool;
    let ctx: ToolContext;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({
            'hello.txt': 'line1\nline2\nline3\nline4\nline5',
            'large.txt': Array.from({ length: 300 }, (_, i) => `line${i + 1}`).join('\n'),
        });
        tool = new ReadFileTool();
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
            const result = tool.validate({ path: 'hello.txt' });
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('应该拒绝空的 path', () => {
            const result = tool.validate({ path: '' });
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('path 是必填字段，且必须是非空字符串');
        });

        it('应该拒绝非对象的参数', () => {
            const result = tool.validate(null);
            expect(result.valid).toBe(false);
        });

        it('应该拒绝负数 start', () => {
            const result = tool.validate({ path: 'hello.txt', start: -1 });
            expect(result.valid).toBe(false);
        });

        it('应该拒绝 start > end', () => {
            const result = tool.validate({ path: 'hello.txt', start: 5, end: 3 });
            expect(result.valid).toBe(false);
        });

        it('应该设置默认 maxChars', () => {
            const result = tool.validate({ path: 'hello.txt' }) as any;
            expect(result.sanitized.maxChars).toBe(8000);
        });
    });

    describe('execute', () => {
        it('应该读取整个小文件', async () => {
            const result = await tool.execute({ path: 'hello.txt' }, ctx);
            expect(result.success).toBe(true);
            expect((result.data as any).content).toBe('line1\nline2\nline3\nline4\nline5');
            expect((result.data as any).totalLines).toBe(5);
        });

        it('应该支持行范围读取', async () => {
            const result = await tool.execute({ path: 'hello.txt', start: 2, end: 4 }, ctx);
            expect(result.success).toBe(true);
            expect((result.data as any).content).toBe('line2\nline3\nline4');
        });

        it('应该截断大文件', async () => {
            const result = await tool.execute({ path: 'large.txt', maxChars: 40 }, ctx);
            expect(result.success).toBe(true);
            expect((result.data as any).truncated).toBe(true);

            const content = (result.data as any).content as string;
            expect(content.length).toBeLessThan(2000); // 远小于完整内容
            expect(content).toContain('...'); // 有截断标记
        });
        
        it('应该处理不存在的文件', async () => {
            const result = await tool.execute({ path: 'not-exists.txt' }, ctx);
            expect(result.success).toBe(false);
            expect(result.error).toContain('读取失败');
        });
    });
});