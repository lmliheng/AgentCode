// src/test/tools/list_files.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ListFilesTool } from '../../tools/list_files.js';
import { createTestWorkspace, cleanupTestWorkspace } from '../setup.js';
import type { ToolContext } from '../../types/Tool.js';

describe('ListFilesTool', () => {
    let workspaceDir: string;
    let tool: ListFilesTool;
    let ctx: ToolContext;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({
            'src/main.ts': '// main',
            'src/utils/helper.ts': '// helper',
            'src/utils/constants.ts': '// constants',
            'README.md': '# Project',
            'package.json': '{}',
        });
        tool = new ListFilesTool();
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
            expect((result as any).sanitized.maxResults).toBe(200);
        });

        it('应该拒绝负数 depth', () => {
            const result = tool.validate({ depth: -1 });
            expect(result.valid).toBe(false);
        });
    });

    describe('execute', () => {
        it('应该列出根目录下的文件和目录', async () => {
            const result = await tool.execute({}, ctx);
            expect(result.success).toBe(true);
            
            const entries = (result.data as any).entries;
            const names = entries.map((e: any) => e.name);
            expect(names).toContain('src');
            expect(names).toContain('README.md');
            expect(names).toContain('package.json');
        });

        it('应该递归列出所有文件', async () => {
            const result = await tool.execute({ recursive: true }, ctx);
            expect(result.success).toBe(true);
            
            const paths = (result.data as any).entries
                .filter((e: any) => e.type === 'file')
                .map((e: any) => e.path);
            
            expect(paths).toContain('src/main.ts');
            expect(paths).toContain('src/utils/helper.ts');
            expect(paths).toContain('src/utils/constants.ts');
            expect(paths).toContain('README.md');
        });

        it('应该按 pattern 过滤', async () => {
            const result = await tool.execute({ 
                recursive: true, 
                pattern: 'README' 
            }, ctx);
            expect(result.success).toBe(true);
            
            const entries = (result.data as any).entries;
            expect(entries).toHaveLength(1);
            expect(entries[0].name).toBe('README.md');
        });

        it('应该只返回文件', async () => {
            const result = await tool.execute({ 
                includeDirs: false 
            }, ctx);
            expect(result.success).toBe(true);
            
            const entries = (result.data as any).entries;
            expect(entries.every((e: any) => e.type === 'file')).toBe(true);
        });
    });
});