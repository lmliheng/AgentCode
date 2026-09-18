// src/test/tools/apply_diff.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ApplyDiffTool } from '../../tools/apply_diff.js';
import { createTestWorkspace, cleanupTestWorkspace } from '../setup.js';
import type { ToolContext } from '../../types/Tool.js';

describe('ApplyDiffTool', () => {
    let workspaceDir: string;
    let tool: ApplyDiffTool;
    let ctx: ToolContext;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({
            'greeting.ts': `
function greet(name: string) {
    return \`Hello, \${name}!\`;
}

function greetFormal(name: string) {
    return \`Good day, \${name}.\`;
}
`.trim(),
        });
        tool = new ApplyDiffTool();
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
            const result = tool.validate({
                path: 'test.ts',
                old_string: 'foo',
                new_string: 'bar'
            });
            expect(result.valid).toBe(true);
        });

        it('应该拒绝空的 old_string', () => {
            const result = tool.validate({
                path: 'test.ts',
                old_string: '',
                new_string: 'bar'
            });
            expect(result.valid).toBe(false);
        });
    });

    describe('execute', () => {
        it('应该成功替换唯一匹配的内容', async () => {
            const result = await tool.execute({
                path: 'greeting.ts',
                old_string: 'Hello',
                new_string: 'Hi'
            }, ctx);
            expect(result.success).toBe(true);

            const content = readFileSync(join(workspaceDir, 'greeting.ts'), 'utf-8');
            expect(content).toContain('Hi');
            expect(content).not.toContain('Hello'); // 只替换了一个
            expect(content).toContain('Good day');   // 另一个不受影响
        });

        it('应该拒绝不匹配的内容', async () => {
            const result = await tool.execute({
                path: 'greeting.ts',
                old_string: 'Bonjour',
                new_string: 'Hello'
            }, ctx);
            expect(result.success).toBe(false);
            expect(result.error).toContain('未找到');
        });

        it('应该拒绝模糊匹配（多个匹配）', async () => {
            const result = await tool.execute({
                path: 'greeting.ts',
                old_string: 'name',
                new_string: 'username'
            }, ctx);
            expect(result.success).toBe(false);
            expect(result.error).toContain('期望匹配 1 次');
        });

        it('应该支持指定 expected_count', async () => {
            const result = await tool.execute({
                path: 'greeting.ts',
                old_string: 'name',
                new_string: 'fullName',
                expected_count: 4
            }, ctx);
            expect(result.success).toBe(true);

            const content = readFileSync(join(workspaceDir, 'greeting.ts'), 'utf-8');
            expect(content).toContain('fullName');
            expect(content).not.toContain(': name');  // 确认旧的 name 都被替换了
        });
    });
});