import { McpServer, ResourceTemplate, inputRequired, acceptedContent, completable } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { url, z } from 'zod';
/**
 * @在MCP SDK中的server充当服务提供的一方，受host调用
 * 这段参考：https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.html
 */
export function createServer() {
    const server = new McpServer({
        name: 'test-server',
        title: 'test',
        version: '1.0.0',
        description: 'MCP',
        websiteUrl: '...',
        icons: [{
                src: 'https://game.gtimg.cn/images/dfm/cp/a20230823register/poster-role2.jpg',
                theme: 'light'
            }]
    }, {
        /***
         * @工具变更通知客户端更新
         */
        capabilities: {
            tools: {
                listChanged: true
            }
        }
    });
    server.sendToolListChanged();
    server.registerTool('list_disk', {
        title: '查询磁盘',
        description: '查询磁盘名，如C,D盘，以数组的形式返回',
        inputSchema: z.object({}),
        // 设置了outputSchema就要在返回结果里写structuredContent，给应用程序看，
        // 不设置就只返回content的内容，给用户看
        outputSchema: z.object({
            disks: z.array(z.string()).describe('磁盘数组')
        }),
        // 给客户端/模型加注释：能不能调用，怎么调用，要不要二次确认
        //readOnlyHint不是只读，destructiveHint可能具有破坏性，idempotentHint工具幂等性
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
        _meta: {},
    }, async () => {
        try {
            const disks = ['A', 'B', 'E', 'C'];
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(disks, null, 2)
                    }],
                structuredContent: {
                    disks: ['A', 'B', 'E', 'C']
                }
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `获取磁盘列表失败: ${error}`
                    }],
                isError: true,
                structuredContent: {
                    disks: []
                }
            };
        }
    });
    server.registerTool('search_algorithm', {
        title: '获取算法代码',
        description: '查找算法代码，目前仅支持：二分查找',
        inputSchema: z.object({
            algorithm: z.string().describe('算法名')
        }),
        annotations: {},
        _meta: {},
    }, 
    // 第二个参数是ctx 上下文
    async ({ algorithm }) => {
        try {
            if (algorithm === '二分查找') {
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify(`${algorithm},for(let i=0;i<Math.floor((l+r)/2);i++)...`)
                        }]
                };
            }
            return {
                content: [{
                        type: 'text',
                        text: '找不到算法.'
                    }],
                // isError: true
            };
        }
        catch (e) {
            return {
                content: [{
                        type: 'text',
                        text: `算法查询失败：${e}`
                    }],
                isError: true
            };
        }
    });
    /**
     * @批量处理文件
     * 处理过程中通过进度通知向客户端实时报告处理进度
     */
    server.registerTool('process-files', {
        title: '处理文件',
        description: '批量处理文件',
        inputSchema: z.object({ files: z.array(z.string()) })
    }, 
    /**
     * ctx.mcpReq.notify 向客户端应用发送信息，比如进度之类的
     *
     *
     */
    async ({ files }, ctx) => {
        const progressToken = ctx.mcpReq._meta?.progressToken;
        for (let i = 0; i < files.length; i++) {
            // ... process files[i] ...
            // 如果客户端传了 progressToken 说明它支持进度通知，不传就静默
            if (progressToken !== undefined) {
                await ctx.mcpReq.notify({
                    method: 'notifications/progress',
                    params: { progressToken, progress: i + 1, total: files.length, message: `Processed ${files[i]}` }
                });
            }
        }
        return {
            content: [{
                    type: 'text',
                    text: `Processed ${files.length} files`
                }]
        };
    });
    /**
     *
     * ctx.signal.aborted取消
     */
    server.registerTool('scan-archive', {
        description: '扫描每一个页面的版本',
        inputSchema: z.object({ pages: z.number().int() })
    }, async ({ pages }, ctx) => {
        let scanned = 0;
        for (let page = 0; page < pages; page++) {
            if (ctx.mcpReq.signal.aborted) {
                console.error(`Stopped after ${scanned} of ${pages} pages: ${ctx.mcpReq.signal.reason}`);
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 100)); // ... scan one page ...
            scanned++;
        }
        return { content: [{ type: 'text', text: `Scanned ${scanned} pages` }] };
    });
    const SOURCE_URLS = {
        readme: 'https://example.com/sources/readme.md',
        changelog: 'https://example.com/sources/changelog.md'
    };
    server.registerTool('fetch-source', {
        description: 'Download one of the known source files',
        // enum 
        inputSchema: z.object({
            source: z.enum(['readme', 'changelog'])
        })
    }, async ({ source }, ctx) => {
        const response = await fetch(SOURCE_URLS[source], { signal: ctx.mcpReq.signal });
        return { content: [{ type: 'text', text: await response.text() }] };
    });
    /**
     * @向用户提问
     * elicitInput方法已经被弃用了，不再是服务端推送给客户端表单
     * 现在MRTR（Multi-Round-Trip / 多轮往返），工具返回一个 inputRequired(...) 结果，客户端拿到后去问用户，然后再带着答案重新调用
     * 参考：https://ts.sdk.modelcontextprotocol.io/v2/servers/input-required.html
     */
    const feedbackSchema = z.object({
        rating: z.number().min(1).max(5),
        comment: z.string().optional()
    });
    server.registerTool('collect-feedback', {
        title: '检查进度',
        description: '检查进度，有human-in-the-loop',
        inputSchema: z.object({ topic: z.string() })
    }, async ({ topic }, ctx) => {
        // 第 2 轮：读上一轮的回答
        const prev = acceptedContent(ctx.mcpReq?.inputResponses, 'feedback', feedbackSchema);
        if (prev) {
            return {
                content: [{ type: 'text', text: `Recorded: ${JSON.stringify(prev)}` }]
            };
        }
        // 第 1 轮：返回 inputRequired
        return inputRequired({
            inputRequests: {
                feedback: inputRequired.elicit({
                    mode: 'form',
                    message: `${topic}`,
                    requestedSchema: feedbackSchema // ← 直接传 Zod schema
                })
            }
        });
    });
    server.registerTool('deploy', { inputSchema: z.object({ env: z.string() }) }, async ({ env }, ctx) => {
        const confirmed = acceptedContent(ctx.mcpReq.inputResponses, 'confirm');
        if (!confirmed) {
            return inputRequired({
                inputRequests: {
                    confirm: inputRequired.elicit({
                        message: `Deploy to ${env}?`,
                        requestedSchema: { type: 'object', properties: { confirm: { type: 'boolean' } }, required: ['confirm'] }
                    })
                }
            });
        }
        return { content: [{ type: 'text', text: `deployed to ${env}` }] };
    });
    /**
     * @注册资源
     * Resource
     * input: 资源名，资源uri，资源详细信息(标题，描述，类型)，异步回调函数
     *
     */
    server.registerResource('config', 'config://app', {
        title: 'application config',
        description: '应用设置',
        mimeType: 'text/plain'
    }, 
    // 和文档写的不一样，反正这里是一个异步回调
    async function (uri) {
        // 这里可以text内容可以 读文件、查数据库获取等
        return {
            contents: [{
                    uri: uri.href,
                    text: 'log_level=warming\nregion=china'
                }]
        };
    });
    server.registerResource('user-profile', new ResourceTemplate('users://{userId}/profile', { list: undefined }), {
        title: 'User Profile',
        description: 'Profile data for one user',
        mimeType: 'application/json'
    }, async (uri, { userId }) => ({
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ userId, plan: 'pro' }) }]
    }));
    server.registerResource('readme', new ResourceTemplate('repo://{repo}/readme', {
        list: undefined,
        complete: {
            repo: async (value) => {
                const repos = await listRepos();
                return repos.filter(repo => repo.startsWith(value));
            }
        }
    }), {
        description: 'The README of one repository'
    }, async (uri, { repo }) => ({
        contents: [{ uri: uri.href, text: `Repository: ${repo}` }]
    }));
    let repoCache = [];
    async function listRepos() {
        if (repoCache)
            return repoCache;
        const res = await fetch('https://api.github.com/users/lmliheng/repos');
        if (!res.ok) {
            return [];
        }
        const repos = await res.json();
        repoCache = repos.map((repo) => repo.name);
        return repoCache;
    }
    const languages = ['typescript', 'javascript', 'python', 'rust', 'go'];
    /**
     * @注册提示词
     */
    server.registerPrompt('review-code', {
        title: 'Code Review',
        description: '审查代码的最佳实践和潜在问题',
        // zod raw shape，不用在外加z.object({})
        argsSchema: z.object({
            code: z.string().describe('需要审查的代码'),
            // completable：自动补全，值可以从远端获取 参考：https://ts.sdk.modelcontextprotocol.io/v2/servers/completion.html
            language: completable(z.string().describe('Programming language'), value => languages.filter(language => language.startsWith(value)))
        })
    }, ({ code, language }) => ({
        messages: [
            {
                role: 'user',
                content: { type: 'text', text: `审核这个${language}代码：\n\n${code}，\n\n如果里面涉及算法的知识，请务必模拟运行案例，说明算法难度` }
            }
        ]
    }));
    server.registerPrompt('project', {
        title: '构建/维护/增强项目时需要的提示词',
        description: '完成项目时需要添加的提示词，Agent多方面分析用户需求之后，提问用户，等待两者思路一致后开始运行',
        // zod raw shape，不用在外加z.object({})
        argsSchema: z.object({
            text: z.string().describe('用户语句')
        })
    }, ({ text }) => ({
        messages: [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: `${text}，\n\n针对我的计划，反复追问每一个细节，直到我们形成共同理解。沿着决策树的每个分支往下走，逐一理清各项决策之间的依赖关系，有些选择必须等前一个问题确定了才能回答，AI 会按这个先后顺序逐个问清楚。每个问题都要给出你的推荐答案。
每次只问一个问题，等我回答了再问下一个。一次抛出一堆问题会让人不知所措。
能通过查看环境（文件系统、工具等）找到的事实，直接去查，不用问我。但决策是我来做的，每个决策都要等我拍板。
确认双方理解一致之前，不要开始行动。`
                }
            }
        ]
    }));
    return server;
}
void serveStdio(createServer);
console.error('MCP server running on stdio');
