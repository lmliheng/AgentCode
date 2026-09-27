import { z } from 'zod';
import { runWxCloud, okResult, errorResult } from '../utils/wxcloud.js';
export function register(server) {
    server.registerTool('wxcloud_init', {
        title: '初始化项目',
        description: '初始化一个微信云托管项目目录，可选使用模板',
        inputSchema: { path: z.string().optional().describe('项目根目录，默认当前目录'), template: z.enum(['wxcloudrun-springboot', 'wxcloudrun-express']).optional().describe('使用的模板名称') },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    }, async ({ path: projectPath, template }) => {
        try {
            const args = ['init'];
            if (projectPath)
                args.push(projectPath);
            if (template)
                args.push('-s', template);
            const { stdout, stderr } = await runWxCloud(args);
            const msg = stdout.trim() || stderr.trim() || '项目初始化完成';
            return okResult(msg);
        }
        catch (e) {
            return errorResult(`初始化失败: ${e}`);
        }
    });
}
