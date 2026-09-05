import type { McpServer, ToolCallback } from '@modelcontextprotocol/server'
import { okResult } from '../utils/wxcloud.js'

export function register(server: McpServer) {
  const handler: ToolCallback = async () => {
    const info = {
      status: 'ok',
      server: 'wxcloud-mcp',
      version: '1.0.0',
      runtime: process.version,
      platform: process.platform,
    }
    return okResult(JSON.stringify(info, null, 2), info)
  }

  server.registerTool(
    'wxcloud_health',
    {
      title: '健康检查',
      description: '检查 MCP Server 运行状态，返回版本信息',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    handler
  )
}