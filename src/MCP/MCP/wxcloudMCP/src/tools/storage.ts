import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import { runWxCloud, okResult, errorResult } from '../utils/wxcloud.js'
import { REGION_ENUM, WXCLOUD_DEPLOY_TIMEOUT } from '../types.js'

export function register(server: McpServer) {
  server.registerTool(
    'wxcloud_storage_upload',
    {
      title: '上传对象存储',
      description: '将本地文件/目录上传到对象存储',
      inputSchema: {
        path: z.string().optional().describe('文件/目录路径，默认当前目录'),
        envId: z.string().describe('环境 ID'),
        remotePath: z.string().optional().describe('存储目标目录'),
        mode: z.enum(['staticstorage', 'storage']).optional().describe('上传模式：staticstorage 静态托管 / storage 文件存储'),
        concurrency: z.number().int().min(1).optional().describe('并发上传数量'),
        region: z.enum(REGION_ENUM).optional().describe('地域，默认 ap-shanghai'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ path: localPath, envId, remotePath, mode, concurrency, region }) => {
      try {
        const args = ['storage:upload', '-e', envId]
        if (localPath) args.push(localPath)
        if (remotePath) args.push('-r', remotePath)
        if (mode) args.push('-m', mode)
        if (concurrency !== undefined) args.push('-c', String(concurrency))
        if (region) args.push('--region', region)
        const { stdout, stderr } = await runWxCloud(args, WXCLOUD_DEPLOY_TIMEOUT)
        const msg = stdout.trim() || stderr.trim() || '对象存储上传成功'
        return okResult(msg)
      } catch (e) {
        return errorResult(`上传对象存储失败: ${e}`)
      }
    }
  )
}