// tests/tools/edit-file.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EditFileTool } from '../../tools/edit_file.js';
import { createTestWorkspace, cleanupTestWorkspace } from '../setup.js';
import type { ToolContext } from '../../types/Tool.js';

describe('EditFileTool', () => {
    let workspaceDir: string;
    let tool: EditFileTool;
    let ctx: ToolContext;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({
            'user.ts': `
function getUser(id: string) {
    const user = db.findUser(id);
    return user.name;
}
`.trim(),
            'multi-match.txt': 'foo foo foo',
        });
        tool = new EditFileTool();
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
            const result = tool.validate({
                path: 'user.ts',
                old_string: 'user.name',
                new_string: 'user?.name ?? "anonymous"',
            });
            expect(result.valid).toBe(true);
        });

        it('应该拒绝缺少 old_string', () => {
            const result = tool.validate({
                path: 'user.ts',
                new_string: 'xxx',
            });
            expect(result.valid).toBe(false);
        });

        it('应该设置默认 expected_count', () => {
            const result = tool.validate({
                path: 'user.ts',
                old_string: 'a',
                new_string: 'b',
            }) as any;
            expect(result.sanitized.expected_count).toBe(1);
        });
    });

    describe(
        'execute', () => {
            it('应该成功替换文件内容', async () => {

                // 先看看文件实际内容
                const actualContent = readFileSync(resolve(workspaceDir, 'user.ts'), 'utf-8');

                const result = await tool.execute({
                    path: 'user.ts',
                    old_string: '    return user.name;',  // ★ 带上缩进和分号
                    new_string: '    return user?.name ?? "anonymous";',
                    expected_count: 1,
                }, ctx);

          
                expect(result.success).toBe(true);

                const content = readFileSync(resolve(workspaceDir, 'user.ts'), 'utf-8');
                expect(content).toContain('user?.name ?? "anonymous"');
                expect(content).not.toContain('return user.name;');
            });

            it('dryRun 模式不应该写盘', async () => {
                const beforeContent = readFileSync(resolve(workspaceDir, 'user.ts'), 'utf-8');

                const result = await tool.execute({
                    path: 'user.ts',
                    old_string: '    return user.name;',  // ★ 同上
                    new_string: '    return user?.name ?? "anonymous";',
                    dryRun: true,
                    expected_count: 1,
                }, ctx);

                console.log('=== dryRun 执行结果 ===');
                console.log(JSON.stringify(result));


                expect(result.success).toBe(true);
                expect((result.data as any).dryRun).toBe(true);

                const afterContent = readFileSync(resolve(workspaceDir, 'user.ts'), 'utf-8');
                expect(afterContent).toBe(beforeContent);
            });

            it('应该检测到匹配次数不一致', async () => {
                const result = await tool.execute({
                    path: 'multi-match.txt',
                    old_string: 'foo',
                    new_string: 'bar',
                    expected_count: 2, // 实际有 3 个
                }, ctx);

                expect(result.success).toBe(false);
                expect(result.error).toContain('匹配次数不匹配');
            });

            it('应该检测到找不到匹配', async () => {
                const result = await tool.execute({
                    path: 'user.ts',
                    old_string: 'not-exists-string',
                    new_string: 'xxx',
                }, ctx);

                expect(result.success).toBe(false);
                expect(result.error).toContain('未找到匹配');
            });
        })
})