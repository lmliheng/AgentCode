
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { CreateFileTool } from '../../tools/create_file.js';
import { createTestWorkspace, cleanupTestWorkspace } from '../setup.js';
import type { ToolContext } from '../../types/Tool.js';

describe('CreateFileTool', () => {
    let workspaceDir: string;
    let tool: CreateFileTool;
    let ctx: ToolContext;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({});
        tool = new CreateFileTool();
        ctx = {
            workspaceRoot: workspaceDir,
            allowedPaths: [workspaceDir],
            runId: 'test-run-001',
            requestApproval: async () => 'approve' as const,
        };
    });

    afterEach(() => {
        cleanupTestWorkspace(workspaceDir);
    });

    describe('validate', () => {
        it('应该接受合法参数', () => {
            const result = tool.validate({ path: 'src/test.ts', content: 'console.log("hi");' });
            expect(result.valid).toBe(true);
        });

        it('应该拒绝空的 path', () => {
            const result = tool.validate({ path: '', content: 'hi' });
            expect(result.valid).toBe(false);
        });

        it('应该拒绝路径穿越', () => {
            const result = tool.validate({ path: '../../etc/passwd', content: 'hack' });
            expect(result.valid).toBe(false);
        });

        it('应该拒绝绝对路径', () => {
            // Windows 上用 C:\xxx，其他系统用 /etc/config
            const absolutePath = process.platform === 'win32'
                ? 'C:\\Windows\\system32\\config'
                : '/etc/config';
            const result = tool.validate({ path: absolutePath, content: 'data' });
            expect(result.valid).toBe(false);
        });
    });

    describe('execute', () => {
        it('应该创建新文件', async () => {
            const result = await tool.execute({
                path: 'src/new-file.ts',
                content: 'export const x = 1;'
            }, ctx);

            expect(result.success).toBe(true);
            expect((result.data as any).created).toBe(true);

            const filePath = join(workspaceDir, 'src/new-file.ts');
            expect(existsSync(filePath)).toBe(true);
            expect(readFileSync(filePath, 'utf-8')).toBe('export const x = 1;');
        });

        it('应该拒绝覆盖已有文件', async () => {
            // 先创建一个文件
            await tool.execute({
                path: 'existing.txt',
                content: 'original'
            }, ctx);

            // 尝试覆盖
            const result = await tool.execute({
                path: 'existing.txt',
                content: 'updated'
            }, ctx);

            expect(result.success).toBe(false);
            expect(result.error).toContain('已存在');
        });

        it('应该支持覆盖已有文件', async () => {
            await tool.execute({
                path: 'existing.txt',
                content: 'original'
            }, ctx);

            const result = await tool.execute({
                path: 'existing.txt',
                content: 'updated',
                overwrite: true
            }, ctx);

            expect(result.success).toBe(true);
            const filePath = join(workspaceDir, 'existing.txt');
            expect(readFileSync(filePath, 'utf-8')).toBe('updated');
        });

        it('应该在嵌套目录中创建文件', async () => {
            const result = await tool.execute({
                path: 'a/b/c/deep-file.ts',
                content: '// deep'
            }, ctx);

            expect(result.success).toBe(true);
            const filePath = join(workspaceDir, 'a/b/c/deep-file.ts');
            expect(existsSync(filePath)).toBe(true);
        });
    });
});