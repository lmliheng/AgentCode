// src/test/tools/glob.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GlobTool } from '../src/glob.js';
import { createTestWorkspace, cleanupTestWorkspace } from './setup.js';
import type { ToolContext } from '@lmliheng/acode-core';

describe('GlobTool', () => {
    let workspaceDir: string;
    let tool: GlobTool;
    let ctx: ToolContext;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({
            'src/main.ts': '// main',
            'src/utils/helper.ts': '// helper',
            'src/utils/helper.test.ts': '// test',
            'README.md': '# Project',
            'docs/guide.md': '# Guide',
            'docs/deep/nested.md': '# Nested',
            'node_modules/pkg/index.ts': '// dep',
            'dist/bundle.ts': '// built',
        });
        tool = new GlobTool();
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
        it('pattern 必填且非空', () => {
            expect(tool.validate({}).valid).toBe(false);
            expect(tool.validate({ pattern: '   ' }).valid).toBe(false);
            expect(tool.validate({ pattern: '**/*.ts' }).valid).toBe(true);
        });

        it('maxResults 必须为正数，并被硬顶收敛', () => {
            expect(tool.validate({ pattern: '*.ts', maxResults: 0 }).valid).toBe(false);
            const huge = tool.validate({ pattern: '*.ts', maxResults: 999_999 });
            expect((huge as any).sanitized.maxResults).toBe(2000);
        });
    });

    describe('匹配', () => {
        it('** 跨目录匹配，且不返回目录', async () => {
            const result = await tool.execute({ pattern: 'src/**/*.ts' }, ctx);

            expect(result.success).toBe(true);
            const matches = (result.data as any).matches;
            expect(matches).toContain('src/main.ts');
            expect(matches).toContain('src/utils/helper.ts');
            expect(matches).not.toContain('src/utils');
        });

        it('不写 / 的模式按任意目录下的文件名理解', async () => {
            const result = await tool.execute({ pattern: '*.md' }, ctx);

            const matches = (result.data as any).matches;
            expect(matches).toEqual(['README.md', 'docs/deep/nested.md', 'docs/guide.md']);
        });

        it('{a,b} 多选一', async () => {
            const result = await tool.execute({ pattern: 'src/**/*.{ts,md}' }, ctx);

            const matches = (result.data as any).matches;
            expect(matches).toContain('src/main.ts');
            expect(matches).toContain('src/utils/helper.test.ts');
            expect(matches.every((path: string) => path.startsWith('src/'))).toBe(true);
        });

        it('默认跳过 node_modules / dist', async () => {
            const result = await tool.execute({ pattern: '**/*.ts' }, ctx);

            const matches = (result.data as any).matches;
            expect(matches).toContain('src/main.ts');
            expect(matches).not.toContain('node_modules/pkg/index.ts');
            expect(matches).not.toContain('dist/bundle.ts');
        });

        it('includeIgnored 时才搜被忽略的目录', async () => {
            const result = await tool.execute({ pattern: '**/*.ts', includeIgnored: true }, ctx);

            const matches = (result.data as any).matches;
            expect(matches).toContain('node_modules/pkg/index.ts');
            expect(matches).toContain('dist/bundle.ts');
        });

        it('场景：想找测试文件，从前 pattern 匹配不到', async () => {
            const result = await tool.execute({ pattern: '**/*.test.ts' }, ctx);

            expect((result.data as any).matches).toEqual(['src/utils/helper.test.ts']);
        });

        it('path 只缩小搜索范围，返回的路径仍相对工作区根', async () => {
            const result = await tool.execute({ pattern: '**/*.ts', path: 'src' }, ctx);

            const matches = (result.data as any).matches;
            expect(matches).toEqual(['src/main.ts', 'src/utils/helper.test.ts', 'src/utils/helper.ts']);
            expect(matches.every((path: string) => path.startsWith('src/'))).toBe(true);
        });

        it('结果按路径排序，total 与 truncated 如实反映', async () => {
            const result = await tool.execute({ pattern: '**/*.md', maxResults: 2 }, ctx);

            const data = result.data as any;
            expect(data.matches).toEqual(['README.md', 'docs/deep/nested.md']);
            expect(data.total).toBe(3);
            expect(data.truncated).toBe(true);
            expect(result.display).toContain('只返回前 2 个');
        });

        it('没有命中时是成功而不是失败', async () => {
            const result = await tool.execute({ pattern: '**/*.rs' }, ctx);

            expect(result.success).toBe(true);
            expect((result.data as any).matches).toEqual([]);
            expect((result.data as any).total).toBe(0);
        });

        it('路径越界时拒绝，不读工作区之外', async () => {
            const result = await tool.execute({ pattern: '**/*.ts', path: '..' }, ctx);

            expect(result.success).toBe(false);
            expect(result.error).toContain('不在允许的工作区内');
        });

        it('起始路径不存在时返回空结果，不抛错', async () => {
            // fs-guard 只判边界不判存在；读不到的目录由 walk 吞掉，于是这是一次
            // 「没命中」而不是「失败」—— 与「目录是空的」对调用方是同一件事。
            const result = await tool.execute({ pattern: '*', path: 'no-such-dir' }, ctx);

            expect(result.success).toBe(true);
            expect((result.data as any).matches).toEqual([]);
        });
    });
});
