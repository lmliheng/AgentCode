import { z } from 'zod';
import { runWxCloud, jsonOrRaw, okResult, errorResult } from '../utils/wxcloud.js';
import { REGION_ENUM, WXCLOUD_DEPLOY_TIMEOUT } from '../types.js';
export function register(server) {
    server.registerTool('wxcloud_run_deploy', {
        title: '部署云托管版本',
        description: '将本地项目部署为云托管新版本（可能需要较长时间，默认超时 5 分钟）',
        inputSchema: {
            path: z.string().optional().describe('项目根目录，默认当前目录'),
            envId: z.string().describe('环境 ID'),
            serviceName: z.string().describe('服务名称'),
            containerPort: z.number().int().optional().describe('容器监听端口'),
            dockerfile: z.string().optional().describe('Dockerfile 文件名'),
            envParams: z.string().optional().describe('服务环境变量，格式 xx=a&yy=b'),
            releaseType: z.enum(['FULL', 'GRAY']).optional().describe('FULL 全量发布 / GRAY 灰度发布'),
            remark: z.string().optional().describe('版本备注'),
            detach: z.boolean().optional().describe('是否直接返回不显示部署日志，默认 false'),
            region: z.enum(REGION_ENUM).optional().describe('地域，默认 ap-shanghai'),
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    }, async ({ path: projectPath, envId, serviceName, containerPort, dockerfile, envParams, releaseType, remark, detach, region, }) => {
        try {
            const args = ['run:deploy', '-e', envId, '-s', serviceName];
            if (projectPath)
                args.push(projectPath);
            if (containerPort !== undefined)
                args.push('--containerPort', String(containerPort));
            if (dockerfile)
                args.push('--dockerfile', dockerfile);
            if (envParams)
                args.push('--envParams', envParams);
            if (releaseType)
                args.push('--releaseType', releaseType);
            if (remark)
                args.push('--remark', remark);
            if (detach)
                args.push('--detach');
            // MCP 场景无交互，始终跳过确认
            args.push('--noConfirm');
            if (region)
                args.push('--region', region);
            const { stdout, stderr } = await runWxCloud(args, WXCLOUD_DEPLOY_TIMEOUT);
            const msg = stdout.trim() || stderr.trim() || '部署完成';
            return okResult(msg);
        }
        catch (e) {
            return errorResult(`部署失败: ${e}`);
        }
    });
    server.registerTool('wxcloud_run_rollback', {
        title: '版本回退',
        description: '将云托管服务回退到指定版本',
        inputSchema: {
            envId: z.string().describe('环境 ID'),
            serviceName: z.string().describe('服务名称'),
            version: z.string().describe('回退到的版本号'),
            detach: z.boolean().optional().describe('是否直接返回不显示日志，默认 true'),
            region: z.enum(REGION_ENUM).optional().describe('地域，默认 ap-shanghai'),
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    }, async ({ envId, serviceName, version, detach, region }) => {
        try {
            const args = ['run:rollback', '-e', envId, '-s', serviceName, '-v', version];
            if (detach !== false)
                args.push('--detach');
            // MCP 场景无交互，始终跳过确认
            args.push('--noConfirm');
            if (region)
                args.push('--region', region);
            return await jsonOrRaw(args, WXCLOUD_DEPLOY_TIMEOUT);
        }
        catch (e) {
            return errorResult(`版本回退失败: ${e}`);
        }
    });
}
