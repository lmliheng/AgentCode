import { z } from 'zod';
import { jsonOrRaw, errorResult } from '../utils/wxcloud.js';
import { REGION_ENUM } from '../types.js';
export function register(server) {
    server.registerTool('wxcloud_env_list', {
        title: '查看环境列表',
        description: '获取当前账号下的微信云环境列表',
        inputSchema: { region: z.enum(REGION_ENUM).optional().describe('地域，默认 ap-shanghai') },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    }, async ({ region }) => {
        try {
            const args = ['env:list', '--json'];
            if (region)
                args.push('--region', region);
            return await jsonOrRaw(args);
        }
        catch (e) {
            return errorResult(`获取环境列表失败: ${e}`);
        }
    });
}
