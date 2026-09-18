// src/test/tools/fetch_url.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FetchUrlTool } from '../../tools/fetch_url.js';
import { createTestWorkspace, cleanupTestWorkspace } from '../setup.js';
import type { ToolContext } from '../../types/Tool.js';

describe('FetchUrlTool', () => {
    let workspaceDir: string;
    let tool: FetchUrlTool;
    let ctx: ToolContext;

    beforeEach(() => {
        workspaceDir = createTestWorkspace({});
        tool = new FetchUrlTool();
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
        it('应该接受合法的 URL', () => {
            const result = tool.validate({ url: 'https://example.com' });
            expect(result.valid).toBe(true);
        });

        it('应该拒绝空的 URL', () => {
            const result = tool.validate({ url: '' });
            expect(result.valid).toBe(false);
        });

        it('应该拒绝非法的 URL', () => {
            const result = tool.validate({ url: 'not-a-url' });
            expect(result.valid).toBe(false);
        });

        it('应该拒绝非 http/https 协议', () => {
            const result = tool.validate({ url: 'ftp://files.example.com' });
            expect(result.valid).toBe(false);
        });

        it('应该拒绝无效的 method', () => {
            const result = tool.validate({ url: 'https://example.com', method: 'POST' });
            expect(result.valid).toBe(false);
        });
    });

    describe('execute', () => {
        it('应该成功获取 URL 内容', async () => {
            const result = await tool.execute({ 
                url: 'https://httpbin.org/get' 
            }, ctx);
            expect(result.success).toBe(true);
            expect((result.data as any).status).toBe(200);
            expect((result.data as any).body).toBeDefined();
        });

        it('应该处理 404', async () => {
            const result = await tool.execute({ 
                url: 'https://httpbin.org/status/404' 
            }, ctx);
            expect(result.success).toBe(false);
            expect((result.data as any).status).toBe(404);
        });

        it('应该拒绝未授权的请求', async () => {
            const rejectCtx: ToolContext = {
                ...ctx,
                requestApproval: async () => 'reject' as const,
            };
            const result = await tool.execute({ 
                url: 'https://example.com' 
            }, rejectCtx);
            expect(result.success).toBe(false);
            expect(result.error).toContain('取消');
        });

        it('应该处理超时', async () => {
            const result = await tool.execute({ 
                url: 'https://httpbin.org/delay/5',
                timeout: 1000 
            }, ctx);
            expect(result.success).toBe(false);
            expect(result.error).toContain('超时');
        });
    });
});