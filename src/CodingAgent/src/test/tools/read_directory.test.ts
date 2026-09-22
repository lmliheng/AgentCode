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

    describe('display（执行摘要）', () => {
        // 摘要里的数字必须够数才报得出来：data.total 只是顶层条目数，
        // 「这个目录下多少个文件」只能靠遍历时就地数。

        it('报出实际读到的文件数与目录数', async () => {
            // 默认 maxDepth=1：起始目录的条目，外加每个子目录展开一层
            const result = await tool.execute({}, ctx);
            expect(result.display).toBe('. / 2 个文件、2 个目录');
        });

        it('层数变化时摘要跟着变，不报没读到的部分', async () => {
            const deeper = await tool.execute({ maxDepth: 2 }, ctx);
            expect(deeper.display).toBe('. / 4 个文件、2 个目录');
        });

        it('隐藏文件默认不计入，显式要求时才计入', async () => {
            const withHidden = await tool.execute({ showHidden: true }, ctx);
            expect(withHidden.display).toBe('. / 3 个文件、2 个目录');
        });

        it('摘要用调用时的 path 作为主体', async () => {
            const result = await tool.execute({ path: 'src' }, ctx);
            expect(result.display).toBe('src / 3 个文件、1 个目录');
        });

        it('达到 maxItems 时标注可能未列全', async () => {
            const result = await tool.execute({ maxItems: 1 }, ctx);

            expect(result.success).toBe(true);
            // 只断言标注存在：条目参与是 readdirSync 的顺序，具体数字不稳定
            expect(result.display).toContain('已达上限，可能未列全');
        });

        it('没有触发上限时不标注', async () => {
            const result = await tool.execute({}, ctx);
            expect(result.display).not.toContain('已达上限');
        });
    });
});