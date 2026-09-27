import { z } from 'zod';
import { runWxCloud, okResult, errorResult } from '../utils/wxcloud.js';
export function register(server) {
    server.registerTool('wxcloud_function_upload', {
        title: '上传云函数',
        description: '将本地代码目录上传为云函数',
        inputSchema: {
            path: z.string().optional().describe('云函数代码目录，默认当前目录'),
            envId: z.string().describe('环境 ID'),
            name: z.string().describe('云函数名称'),
            remoteNpmInstall: z.boolean().optional().describe('是否云端安装依赖，默认 false'),
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    }, async ({ path: codePath, envId, name, remoteNpmInstall }) => {
        try {
            const args = ['function:upload', '-e', envId, '-n', name];
            if (codePath)
                args.push(codePath);
            if (remoteNpmInstall)
                args.push('--remoteNpmInstall');
            const { stdout, stderr } = await runWxCloud(args);
            const msg = stdout.trim() || stderr.trim() || '云函数上传成功';
            return okResult(msg);
        }
        catch (e) {
            return errorResult(`上传云函数失败: ${e}`);
        }
    });
}
