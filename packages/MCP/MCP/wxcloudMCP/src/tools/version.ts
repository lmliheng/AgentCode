import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import { jsonOrRaw, errorResult } from '../utils/wxcloud.js'
import { REGION_ENUM } from '../types.js'

export function register(server: McpServer) {
  server.registerTool(
    'wxcloud_version_list',
    {
      title: '获取版本列表',
      description: '获取云托管服务的版本发布列表',
      inputSchema: {
        envId: z.string().describe('环境 ID'),
        serviceName: z.string().describe('服务名称'),
        page: z.number().int().min(1).optional().describe('页码，默认第 1 页'),
        region: z.enum(REGION_ENUM).optional().describe('地域，默认 ap-shanghai'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ envId, serviceName, page, region }) => {
      try {
        const args = ['version:list', '-e', envId, '-s', serviceName, '--json']
        if (page !== undefined) args.push('-p', String(page))
        if (region) args.push('--region', region)
        return await jsonOrRaw(args)
      } catch (e) {
        return errorResult(`获取版本列表失败: ${e}`)
      }
    }
  )
}