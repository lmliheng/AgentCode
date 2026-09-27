// src/test/tools/git_operation.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { GitOperationTool } from '../../tools/git_operation.js';
import { createTestWorkspace, cleanupTestWorkspace } from '../setup.js';
import type { ToolContext } from '../../types/Tool.js';

describe('GitOperationTool', () => {
    let workspaceDir: string;
    let tool: GitOperationTool;
    let ctx: ToolContext;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({
            'file.txt': 'initial content',
        });
        
        // 初始化 git 仓库
        execSync('git init', { cwd: workspaceDir, stdio: 'pipe' });
        execSync('git config user.email "test@test.com"', { cwd: workspaceDir, stdio: 'pipe' });
        execSync('git config user.name "Test"', { cwd: workspaceDir, stdio: 'pipe' });
        execSync('git add .', { cwd: workspaceDir, stdio: 'pipe' });
        execSync('git commit -m "initial commit"', { cwd: workspaceDir, stdio: 'pipe' });

        tool = new GitOperationTool();
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
        it('应该接受合法的操作', () => {
            const result = tool.validate({ operation: 'status' });
            expect(result.valid).toBe(true);
        });

        it('应该拒绝无效的操作', () => {
            const result = tool.validate({ operation: 'invalid' });
            expect(result.valid).toBe(false);
        });

        it('commit 需要 message', () => {
            const result = tool.validate({ operation: 'commit' });
            expect(result.valid).toBe(false);
        });
    });

    describe('execute', () => {
        it('应该查看状态', async () => {
            const result = await tool.execute({ operation: 'status' }, ctx);
            expect(result.success).toBe(true);
            expect(result.data).toBeDefined();
        });

        it('应该查看日志', async () => {
            const result = await tool.execute({ operation: 'log', limit: 5 }, ctx);
            expect(result.success).toBe(true);
            expect((result.data as any).output).toContain('initial commit');
        });

        it('应该添加并提交文件', async () => {
            // 修改文件
            writeFileSync(join(workspaceDir, 'file.txt'), 'modified content');
            
            const addResult = await tool.execute({ operation: 'add' }, ctx);
            expect(addResult.success).toBe(true);

            const commitResult = await tool.execute({ 
                operation: 'commit', 
                message: 'update file' 
            }, ctx);
            expect(commitResult.success).toBe(true);
            expect((commitResult.data as any).output).toContain('update file');
        });

        it('应该拒绝未授权的写操作', async () => {
            const rejectCtx: ToolContext = {
                ...ctx,
                requestApproval: async () => 'reject' as const,
            };
            const result = await tool.execute({ operation: 'add' }, rejectCtx);
            expect(result.success).toBe(false);
            expect(result.error).toContain('取消');
        });
    });
});