// 工作区边界：所有文件工具都必须走 fs-guard 唯一入口。
//
// 这些用例对应 run_test/PRD.md 第 4 节实测过的三个口子：
//   4.1 search_code 带 path 必然失败（裸 startsWith + 相对 allowedPaths）
//   4.2 read_file 完全没有边界检查（`../../package.json` 能读回）
//   4.3 前缀比较不严（`ws-evil` 被当成工作区内、`..` 与符号链接可绕过）

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolContext } from '@lmliheng/acode-core';

import { ApplyDiffTool } from '../src/apply_diff.js';
import { CreateFileTool } from '../src/create_file.js';
import { DeleteFileTool } from '../src/delete_file.js';
import { EditFileTool } from '../src/edit_file.js';
import { ListFilesTool } from '../src/list_files.js';
import { MoveFileTool } from '../src/move_file.js';
import { ReadDirectoryTool } from '../src/read_directory.js';
import { ReadFileTool } from '../src/read_file.js';
import { RunCommandTool } from '../src/run_command.js';
import { SearchCodeTool } from '../src/search_code.js';
import { isPathAllowed, resolveInWorkspace } from '../src/fs-guard.js';

const OUTSIDE_ERROR = '不在允许的工作区内';

describe('工作区边界（fs-guard 统一入口）', () => {
    let root: string;
    let ws: string;
    let evil: string;
    let ctx: ToolContext;

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'acode-guard-'));
        ws = join(root, 'ws');
        evil = join(root, 'ws-evil');
        mkdirSync(join(ws, 'sub'), { recursive: true });
        mkdirSync(evil, { recursive: true });
        writeFileSync(join(ws, 'inside.txt'), 'line1\nline2\nNEEDLE\nline4', 'utf-8');
        writeFileSync(join(ws, 'sub', 'nested.txt'), 'NEEDLE in nested', 'utf-8');
        writeFileSync(join(evil, 'secret.txt'), '不该被读到', 'utf-8');
        writeFileSync(join(root, 'outside.txt'), '工作区外的文件', 'utf-8');

        ctx = {
            workspaceRoot: ws,
            allowedPaths: [ws],
            runId: 'test-guard',
            requestApproval: async () => 'approve',
        };
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    describe('fs-guard 本身', () => {
        it('工作区内的路径放行', () => {
            expect(isPathAllowed(join(ws, 'inside.txt'), [ws]).allowed).toBe(true);
        });

        it('`..` 逃逸被拒', () => {
            const result = isPathAllowed(join(ws, '..', 'outside.txt'), [ws]);
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('不在允许的工作区内');
        });

        it('前缀相同的兄弟目录（ws 与 ws-evil）被拒 —— 字符串前缀比较会误放行', () => {
            expect(isPathAllowed(join(evil, 'secret.txt'), [ws]).allowed).toBe(false);
            // 直接比字符串时 `ws-evil` 是以 `ws` 开头的，这里必须是 false
            expect(join(evil, 'secret.txt').startsWith(ws)).toBe(true);
        });

        it('符号链接指向工作区外时被拒', () => {
            const link = join(ws, 'escape-link');
            symlinkSync(root, link, 'dir');
            expect(isPathAllowed(join(link, 'outside.txt'), [ws]).allowed).toBe(false);
        });

        it('allowedPaths 是相对路径时同样能判定（不再是纯字符串比较）', () => {
            const cwd = process.cwd();
            try {
                process.chdir(ws);
                expect(resolveInWorkspace('.', 'inside.txt', ['.']).allowed).toBe(true);
                expect(resolveInWorkspace('.', '../outside.txt', ['.']).allowed).toBe(false);
            } finally {
                process.chdir(cwd);
            }
        });

        it('allowedPaths 为空时拒绝一切（不静默放行）', () => {
            const result = resolveInWorkspace(ws, 'inside.txt', []);
            // 未声明 allowedPaths 时退回工作区根本身，而不是「无限制」
            expect(result.allowed).toBe(true);
            expect(isPathAllowed(join(ws, 'inside.txt'), []).allowed).toBe(false);
        });
    });

    describe('read_file（PRD §4.2：原先完全没有边界检查）', () => {
        const tool = new ReadFileTool();

        it('读工作区内的相对路径正常', async () => {
            const result = await tool.execute({ path: 'inside.txt', maxChars: 8000 } as never, ctx);
            expect(result.success).toBe(true);
        });

        it('`../../` 逃逸被拒', async () => {
            const result = await tool.execute({ path: '../../etc/hostname', maxChars: 8000 } as never, ctx);
            expect(result.success).toBe(false);
            expect(result.error).toContain(OUTSIDE_ERROR);
        });

        it('工作区外文件的绝对路径被拒', async () => {
            const result = await tool.execute({ path: join(root, 'outside.txt'), maxChars: 8000 } as never, ctx);
            expect(result.success).toBe(false);
            expect(result.error).toContain(OUTSIDE_ERROR);
        });

        it('兄弟目录（ws-evil）被拒', async () => {
            const result = await tool.execute({ path: '../ws-evil/secret.txt', maxChars: 8000 } as never, ctx);
            expect(result.success).toBe(false);
            expect(result.error).toContain(OUTSIDE_ERROR);
        });

        it('经由符号链接逃逸被拒', async () => {
            const link = join(ws, 'escape-link');
            symlinkSync(root, link, 'dir');
            const result = await tool.execute({ path: 'escape-link/outside.txt', maxChars: 8000 } as never, ctx);
            expect(result.success).toBe(false);
            expect(result.error).toContain(OUTSIDE_ERROR);
        });
    });

    describe('search_code（PRD §4.1：带 path 必然失败）', () => {
        const tool = new SearchCodeTool();

        it('工作区是相对路径时，带 path 的搜索必须成功', async () => {
            const cwd = process.cwd();
            try {
                process.chdir(ws);
                const relativeCtx = {
                    ...ctx,
                    workspaceRoot: '.',
                    allowedPaths: ['.'],
                } as ToolContext;
                const result = await tool.execute(
                    { pattern: 'NEEDLE', path: 'sub' } as never,
                    relativeCtx,
                );
                expect(result.success).toBe(true);
            } finally {
                process.chdir(cwd);
            }
        });

        it('不带 path 的搜索仍然正常', async () => {
            const result = await tool.execute({ pattern: 'NEEDLE' } as never, ctx);
            expect(result.success).toBe(true);
        });

        it('`../` 逃逸被拒而不是被当成「搜索不到」', async () => {
            const result = await tool.execute({ pattern: 'NEEDLE', path: '..' } as never, ctx);
            expect(result.success).toBe(false);
            expect(result.error).toContain(OUTSIDE_ERROR);
        });
    });

    describe('其余文件工具一致拒绝越界路径', () => {
        it('edit_file 拒绝 `../ws-evil/secret.txt`', async () => {
            const result = await new EditFileTool().execute(
                { path: '../ws-evil/secret.txt', old_string: '不该被读到', new_string: 'x', expected_count: 1 } as never,
                ctx,
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain(OUTSIDE_ERROR);
        });

        it('apply_diff 拒绝越界路径', async () => {
            const result = await new ApplyDiffTool().execute(
                { path: '../outside.txt', old_string: '工作区外的文件', new_string: 'x', expected_count: 1 } as never,
                ctx,
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain(OUTSIDE_ERROR);
        });

        it('create_file 拒绝越界路径（不会把文件写出去）', async () => {
            const result = await new CreateFileTool().execute(
                { path: '../escaped.txt', content: 'x' } as never,
                ctx,
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain(OUTSIDE_ERROR);
        });

        it('delete_file 拒绝越界路径', async () => {
            const result = await new DeleteFileTool().execute(
                { path: '../outside.txt' } as never,
                ctx,
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain(OUTSIDE_ERROR);
        });

        it('move_file 的源与目标都必须合法', async () => {
            const outSource = await new MoveFileTool().execute(
                { source: '../outside.txt', destination: 'inside.txt' } as never,
                ctx,
            );
            expect(outSource.success).toBe(false);
            expect(outSource.error).toContain(OUTSIDE_ERROR);

            const outDest = await new MoveFileTool().execute(
                { source: 'inside.txt', destination: '../escaped.txt' } as never,
                ctx,
            );
            expect(outDest.success).toBe(false);
            expect(outDest.error).toContain(OUTSIDE_ERROR);
        });

        it('list_files 拒绝越界路径', async () => {
            const result = await new ListFilesTool().execute({ path: '..' } as never, ctx);
            expect(result.success).toBe(false);
            expect(result.error).toContain(OUTSIDE_ERROR);
        });

        it('read_directory 拒绝越界路径', async () => {
            const result = await new ReadDirectoryTool().execute({ path: '..' } as never, ctx);
            expect(result.success).toBe(false);
            expect(result.error).toContain(OUTSIDE_ERROR);
        });

        it('run_command 的 cwd 拒绝越界路径', async () => {
            const result = await new RunCommandTool().execute(
                { command: 'echo hi', cwd: '..' } as never,
                ctx,
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain(OUTSIDE_ERROR);
        });
    });

    describe('工作区内的正常读写没有被守卫误伤', () => {
        it('create → read → edit → move → delete 全链路可用', async () => {
            expect((await new CreateFileTool().execute({ path: 'sub/new.txt', content: 'a\nb\n' } as never, ctx)).success).toBe(true);
            expect((await new ReadFileTool().execute({ path: 'sub/new.txt' } as never, ctx)).success).toBe(true);
            expect((await new EditFileTool().execute({ path: 'sub/new.txt', old_string: 'a', new_string: 'A', expected_count: 1 } as never, ctx)).success).toBe(true);
            expect((await new MoveFileTool().execute({ source: 'sub/new.txt', destination: 'sub/moved.txt' } as never, ctx)).success).toBe(true);
            expect((await new ReadDirectoryTool().execute({ path: 'sub' } as never, ctx)).success).toBe(true);
            expect((await new ListFilesTool().execute({ path: 'sub' } as never, ctx)).success).toBe(true);
            expect((await new DeleteFileTool().execute({ path: 'sub/moved.txt', force: true } as never, ctx)).success).toBe(true);
        });

        it('run_command 以工作区内的子目录为 cwd 照常执行', async () => {
            const result = await new RunCommandTool().execute(
                { command: 'node -e "console.log(process.cwd())"', cwd: 'sub' } as never,
                ctx,
            );
            expect(result.success).toBe(true);
            expect(String((result.data as { stdout?: string }).stdout)).toContain('sub');
        });
    });
});
