// src/test/tools/move_file.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { MoveFileTool } from '../../tools/move_file.js';
import { createTestWorkspace, cleanupTestWorkspace } from '../setup.js';
import type { ToolContext } from '../../types/Tool.js';

describe('MoveFileTool', () => {
    let workspaceDir: string;
    let tool: MoveFileTool;
    let ctx: ToolContext;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({
            'source.txt': 'move me',
            'target/existing.txt': 'already here',
        });
        tool = new MoveFileTool();
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
            const result = tool.validate({ source: 'a.txt', destination: 'b.txt' });
            expect(result.valid).toBe(true);
        });

        it('应该拒绝相同的源和目标', () => {
            const result = tool.validate({ source: 'a.txt', destination: 'a.txt' });
            expect(result.valid).toBe(false);
        });
    });

    describe('execute', () => {
        it('应该移动文件', async () => {
            const result = await tool.execute({ 
                source: 'source.txt', 
                destination: 'moved.txt' 
            }, ctx);
            expect(result.success).toBe(true);
            expect(existsSync(join(workspaceDir, 'source.txt'))).toBe(false);
            expect(existsSync(join(workspaceDir, 'moved.txt'))).toBe(true);
        });

        it('应该拒绝移动不存在的文件', async () => {
            const result = await tool.execute({ 
                source: 'nonexistent.txt', 
                destination: 'dest.txt' 
            }, ctx);
            expect(result.success).toBe(false);
            expect(result.error).toContain('不存在');
        });

        it('应该拒绝覆盖已有文件', async () => {
            const result = await tool.execute({ 
                source: 'source.txt', 
                destination: 'target/existing.txt' 
            }, ctx);
            expect(result.success).toBe(false);
            expect(result.error).toContain('已存在');
        });

        it('应该支持覆盖已有文件', async () => {
            const result = await tool.execute({ 
                source: 'source.txt', 
                destination: 'target/existing.txt',
                overwrite: true 
            }, ctx);
            expect(result.success).toBe(true);
            expect(existsSync(join(workspaceDir, 'source.txt'))).toBe(false);
            expect(existsSync(join(workspaceDir, 'target/existing.txt'))).toBe(true);
        });
    });
});