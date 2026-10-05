import type { McpServer, ToolCallback } from '@modelcontextprotocol/server'
import { runWxCloud, okResult, errorResult } from '../utils/wxcloud.js'

export function register(server: McpServer) {
  const handler: ToolCallback = async () => {
    try {
      const { stdout, stderr } = await runWxCloud(['logout'])
      const msg = stdout.trim() || stderr.trim() || '登出成功'
      return okResult(msg)
    } catch (e) {
      return errorResult(`登出失败: ${e}`)
    }
  }

  server.registerTool(
    'wxcloud_logout',
    {
      title: '登出 CLI',
      description: '登出 wxcloud CLI，清除当前登录状态',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    handler
  )
}