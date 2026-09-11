import { runWxCloudJson } from '../utils/wxcloud.js';
export function register(server, ResourceTemplate) {
    // ── 静态资源：环境列表 ──────────────────────────────────────────────
    server.registerResource('wxcloud_environments', 'wxcloud://environments', {
        title: '微信云环境列表',
        description: '当前账号下的所有微信云环境',
        mimeType: 'application/json',
    }, async (_uri) => {
        const { data } = await runWxCloudJson(['env:list', '--json']);
        const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        return {
            contents: [
                {
                    uri: 'wxcloud://environments',
                    mimeType: 'application/json',
                    text,
                },
            ],
        };
    });
    // ── 模板资源：单个环境详情 ──────────────────────────────────────────
    server.registerResource('wxcloud_environment', new ResourceTemplate('wxcloud://environments/{envId}', {
        list: async () => {
            const { data } = await runWxCloudJson(['env:list', '--json']);
            const envs = Array.isArray(data) ? data : [];
            return {
                resources: envs.map((env) => ({
                    uri: `wxcloud://environments/${env['EnvId'] ?? env['env_id'] ?? 'unknown'}`,
                    name: env['Name'] ?? env['name'] ?? env['EnvId'] ?? env['env_id'] ?? 'unknown',
                    mimeType: 'application/json',
                })),
            };
        },
    }), {
        title: '微信云环境详情',
        description: '指定微信云环境的详细信息',
        mimeType: 'application/json',
    }, async (uri) => {
        // 从 URI 中提取 envId
        const envId = uri.pathname.split('/').pop() ?? '';
        const { data } = await runWxCloudJson(['env:list', '--json']);
        const envs = Array.isArray(data) ? data : [];
        const env = envs.find((e) => (e['EnvId'] ?? e['env_id']) === envId);
        const text = env ? JSON.stringify(env, null, 2) : JSON.stringify({ error: `环境 ${envId} 未找到` }, null, 2);
        return {
            contents: [
                {
                    uri: uri.toString(),
                    mimeType: 'application/json',
                    text,
                },
            ],
        };
    });
}
