import { z } from 'zod';
import { runWxCloud, okResult, errorResult } from '../utils/wxcloud.js';
export function register(server) {
    server.registerTool('wxcloud_login', {
        title: '登录 CLI',
        description: '使用 AppID 和私钥登录 wxcloud CLI，登录后才能执行环境/服务等操作',
        inputSchema: { appId: z.string().describe('微信 AppID'), privateKey: z.string().describe('微信云服务私钥') },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    }, async ({ appId, privateKey }) => {
        try {
            const { stdout, stderr } = await runWxCloud(['login', '-a', appId, '-k', privateKey]);
            const msg = stdout.trim() || stderr.trim() || '登录成功';
            return okResult(msg);
        }
        catch (e) {
            return errorResult(`登录失败: ${e}`);
        }
    });
}
