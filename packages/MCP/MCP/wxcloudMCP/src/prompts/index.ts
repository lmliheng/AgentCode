import type { McpServer } from '@modelcontextprotocol/server'

export function register(server: McpServer) {
  // ── 部署工作流提示 ──────────────────────────────────────────────────
  server.registerPrompt(
    'deploy-workflow',
    {
      title: '部署工作流',
      description: '引导用户完成微信云托管服务的部署流程',
    },
    async () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              '# 微信云托管部署工作流',
              '',
              '请按照以下步骤完成部署：',
              '',
              '1. **登录** — 使用 `wxcloud_login` 工具，传入 AppID 和私钥',
              '2. **查看环境** — 使用 `wxcloud_env_list` 确认目标环境',
              '3. **创建服务（可选）** — 使用 `wxcloud_service_create` 创建新服务',
              '4. **部署版本** — 使用 `wxcloud_run_deploy` 部署项目',
              '5. **查看版本** — 使用 `wxcloud_version_list` 确认部署成功',
              '',
              '需要我帮你执行哪个步骤？',
            ].join('\n'),
          },
        },
      ],
    })
  )

  // ── 环境概览提示 ────────────────────────────────────────────────────
  server.registerPrompt(
    'env-overview',
    {
      title: '环境概览',
      description: '查看当前账号下的微信云环境和服务的概览信息',
    },
    async () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              '# 微信云环境概览',
              '',
              '我将帮你查看当前账号下的环境和服务的整体情况。',
              '请先使用 `wxcloud_login` 登录（如果尚未登录），',
              '然后使用 `wxcloud_env_list` 查看所有环境，',
              '再对每个环境使用 `wxcloud_service_list` 查看服务。',
              '',
              '开始吧！',
            ].join('\n'),
          },
        },
      ],
    })
  )
}