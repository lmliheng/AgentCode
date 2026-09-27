// src/test/tools/run_command.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RunCommandTool } from '../../tools/run_command.js';
import { createTestWorkspace, cleanupTestWorkspace } from '../setup.js';
import type { ToolContext } from '../../types/Tool.js';

describe('RunCommandTool', () => {
    let workspaceDir: string;
    let tool: RunCommandTool;
    let ctx: ToolContext;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({
            'package.json': JSON.stringify({ name: 'test-project' }),
            'test.sh': 'echo "hello world"',
        });
        tool = new RunCommandTool();
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
        it('应该接受合法的参数', () => {
            const result = tool.validate({ command: 'npm test' });
            expect(result.valid).toBe(true);
        });

        it('应该拒绝空的 command', () => {
            const result = tool.validate({ command: '' });
            expect(result.valid).toBe(false);
        });

        it('应该拒绝危险命令', () => {
            const result = tool.validate({ command: 'sudo rm -rf /' });
            expect(result.valid).toBe(false);
            expect(result.errors?.[0]).toContain('危险操作');
        });

        it('应该拒绝超时时间过长', () => {
            const result = tool.validate({ command: 'echo hi', timeout: 999999 });
            expect(result.valid).toBe(false);
        });
    });

    describe('execute', () => {
        it('应该成功执行简单命令', async () => {
            const result = await tool.execute({ command: 'echo hello' }, ctx);
            expect(result.success).toBe(true);
            expect((result.data as any).stdout.trim()).toBe('hello');
            expect((result.data as any).exitCode).toBe(0);
        });

        it('应该处理命令失败', async () => {
            const result = await tool.execute({ command: 'exit 1' }, ctx);
            expect(result.success).toBe(false);
            expect((result.data as any).exitCode).toBe(1);
        });

        it('摘要报出退出码与输出行数', async () => {
            const ok = await tool.execute({ command: 'echo hello' }, ctx);
            expect(ok.display).toBe('exit 0 · 输出 1 行');

            // 失败命令同样给摘要：exit 1 正是要看的信息，错误文案另说
            const failed = await tool.execute({ command: 'exit 1' }, ctx);
            expect(failed.display).toBe('exit 1 · 输出 0 行');
        });

        it('应该拒绝未授权的命令', async () => {
            const rejectCtx: ToolContext = {
                ...ctx,
                requestApproval: async () => 'reject' as const,
            };
            const result = await tool.execute({ command: 'echo hello' }, rejectCtx);
            expect(result.success).toBe(false);
            expect(result.error).toContain('取消');
            // 命令根本没跑，没有执行摘要可报 —— 由 error 说清
            expect(result.display).toBeUndefined();
        });

        it('应该在超时后杀掉命令，并回报已捕获的输出', async () => {
            const result = await tool.execute(
                { command: 'node -e "console.log(1);setTimeout(function(){},10000)"', timeout: 1000 },
                ctx
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain('命令超时');
            expect((result.data as any).stdout).toContain('1');
            // 超时属于「进程没能正常结束」，退出码是假的 -1，不报摘要
            expect(result.display).toBeUndefined();
        }, 15000);

        it('应该在未超时时正常返回', async () => {
            const result = await tool.execute({ command: 'echo quick', timeout: 10000 }, ctx);
            expect(result.success).toBe(true);
            expect((result.data as any).stdout.trim()).toBe('quick');
        });
    });
});