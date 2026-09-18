// src/test/tools/read_directory.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ReadDirectoryTool } from '../../tools/read_directory.js';
import { createTestWorkspace, cleanupTestWorkspace } from '../setup.js';
import type { ToolContext } from '../../types/Tool.js';

describe('ReadDirectoryTool', () => {
    let workspaceDir: string;
    let tool: ReadDirectoryTool;
    let ctx: ToolContext;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({
            'src/main.ts': '// main',
            'src/utils/helper.ts': '// helper',
            'src/utils/constants.ts': '// constants',
            'README.md': '# Project',
            '.gitignore': 'node_modules',
        });
        tool = new ReadDirectoryTool();
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
        it('应该接受空参数', () => {
            const result = tool.validate({});
            expect(result.valid).toBe(true);
        });

        it('应该拒绝小于 1 的 maxDepth', () => {
            const result = tool.validate({ maxDepth: 0 });
            expect(result.valid).toBe(false);
        });
    });

    describe('execute', () => {
        it('应该读取根目录结构', async () => {
            const result = await tool.execute({}, ctx);
            expect(result.success).toBe(true);
            
            const structure = (result.data as any).structure;
            expect(structure.type).toBe('directory');
            expect(structure.children.length).toBeGreaterThanOrEqual(2);
            
            const names = structure.children.map((c: any) => c.name);
            expect(names).toContain('src');
            expect(names).toContain('README.md');
        });

        it('应该递归读取子目录', async () => {
            const result = await tool.execute({ maxDepth: 2 }, ctx);
            expect(result.success).toBe(true);
            
            const src = (result.data as any).structure.children
                .find((c: any) => c.name === 'src');
            expect(src).toBeDefined();
            expect(src.type).toBe('directory');
            expect(src.children.length).toBeGreaterThanOrEqual(1);
            
            const utils = src.children.find((c: any) => c.name === 'utils');
            expect(utils).toBeDefined();
            expect(utils.children.length).toBe(2); // helper.ts + constants.ts
        });

        it('应该隐藏以 . 开头的文件', async () => {
            const result = await tool.execute({}, ctx);
            expect(result.success).toBe(true);
            
            const names = (result.data as any).structure.children
                .map((c: any) => c.name);
            expect(names).not.toContain('.gitignore');
        });

        it('应该显示隐藏文件', async () => {
            const result = await tool.execute({ showHidden: true }, ctx);
            expect(result.success).toBe(true);
            
            const names = (result.data as any).structure.children
                .map((c: any) => c.name);
            expect(names).toContain('.gitignore');
        });
    });
});