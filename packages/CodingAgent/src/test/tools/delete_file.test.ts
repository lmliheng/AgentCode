// src/test/tools/delete_file.test

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { DeleteFileTool } from '../../tools/delete_file.js';
import { createTestWorkspace, cleanupTestWorkspace } from '../setup.js';
import type { ToolContext } from '../../types/Tool.js';

describe('DeleteFileTool', () => {
    let workspaceDir: string;
    let tool: DeleteFileTool;
    let ctx: ToolContext;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({
            'to-delete.txt': 'delete me',
            'keep.txt': 'keep me',
            'nested/dir/file.txt': 'deep',
        });
        tool = new DeleteFileTool();
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
            const result = tool.validate({ path: 'temp.txt' });
            expect(result.valid).toBe(true);
        });

        it('应该拒绝空的 path', () => {
            const result = tool.validate({ path: '' });
            expect(result.valid).toBe(false);
        });
    });

    describe('execute', () => {
        it('应该删除文件', async () => {
            const result = await tool.execute({ path: 'to-delete.txt' }, ctx);
            expect(result.success).toBe(true);
            expect(existsSync(join(workspaceDir, 'to-delete.txt'))).toBe(false);
            expect(existsSync(join(workspaceDir, 'keep.txt'))).toBe(true);
        });

        it('应该拒绝删除不存在的文件', async () => {
            const result = await tool.execute({ path: 'nonexistent.txt' }, ctx);
            expect(result.success).toBe(false);
            expect(result.error).toContain('不存在');
        });

        it('应该拒绝未授权操作', async () => {
            const rejectCtx: ToolContext = {
                ...ctx,
                requestApproval: async () => 'reject' as const,
            };
            const result = await tool.execute({ path: 'to-delete.txt' }, rejectCtx);
            expect(result.success).toBe(false);
            expect(result.error).toContain('取消');
        });

        it('force 模式下应跳过确认', async () => {
            const rejectCtx: ToolContext = {
                ...ctx,
                requestApproval: async () => 'reject' as const,
            };
            const result = await tool.execute({
                path: 'to-delete.txt',
                force: true
            }, rejectCtx);
            expect(result.success).toBe(true);
            expect(existsSync(join(workspaceDir, 'to-delete.txt'))).toBe(false);
        });
    });
});