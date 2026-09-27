import { z } from 'zod';
import { jsonOrRaw, errorResult } from '../utils/wxcloud.js';
import { REGION_ENUM } from '../types.js';
export function register(server) {
    server.registerTool('wxcloud_service_list', {
        title: '获取服务列表',
        description: '获取指定环境下的云托管服务列表',
        inputSchema: {
            envId: z.string().describe('环境 ID'),
            serviceName: z.string().optional().describe('服务名称筛选'),
            page: z.number().int().min(1).optional().describe('页码，默认第 1 页'),
            region: z.enum(REGION_ENUM).optional().describe('地域，默认 ap-shanghai'),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    }, async ({ envId, serviceName, page, region }) => {
        try {
            const args = ['service:list', '-e', envId, '--json'];
            if (serviceName)
                args.push('-s', serviceName);
            if (page !== undefined)
                args.push('-p', String(page));
            if (region)
                args.push('--region', region);
            return await jsonOrRaw(args);
        }
        catch (e) {
            return errorResult(`获取服务列表失败: ${e}`);
        }
    });
    server.registerTool('wxcloud_service_create', {
        title: '创建云托管服务',
        description: '在指定环境下创建新的云托管服务',
        inputSchema: {
            envId: z.string().describe('环境 ID'),
            serviceName: z.string().describe('服务名称'),
            isPublic: z.boolean().optional().describe('是否开通外网访问，默认 false'),
            region: z.enum(REGION_ENUM).optional().describe('地域，默认 ap-shanghai'),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    }, async ({ envId, serviceName, isPublic, region }) => {
        try {
            const args = ['service:create', '-e', envId, '-s', serviceName];
            if (isPublic)
                args.push('--isPublic');
            if (region)
                args.push('--region', region);
            return await jsonOrRaw(args);
        }
        catch (e) {
            return errorResult(`创建服务失败: ${e}`);
        }
    });
}
