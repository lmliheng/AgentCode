#!/usr/bin/env node
// test/fixtures/mcp-stub-server.mjs
//
// 一个最小但完整的 stdio MCP server，专供 packages/tools/test/mcp.test.ts 使用。
//
// 为什么是 .mjs 而不是 .ts：测试要用 `process.execPath`（node 本体）直接起它，
// 不依赖 tsx、也不依赖构建产物 —— 一个「连不上外部 server」的测试如果自己还要
// 靠一层转译才跑得起来，失败时得先排除是测试工具链的问题。
//
// 它实现的是协议里被用到的那一段：换行分隔的 JSON-RPC、initialize、
// 分页的 tools/list、tools/call（含 isError、非 text 内容、故意不响应四种返回）。

const PAGE_SIZE = Number(process.env.STUB_PAGE_SIZE ?? '0');
/** 分页用：不告诉 server 任何额外信息，它自己按这个环境变量决定页大小 */
const ALWAYS_MORE = process.env.STUB_ALWAYS_MORE === '1';

const TOOLS = [
    {
        name: 'echo',
        description: '把 text 原样回显，并带上本进程的 pid（测试用它确认子进程身份）',
        inputSchema: {
            type: 'object',
            properties: { text: { type: 'string', description: '要回显的内容' } },
        },
        // 远端自称只读：客户端据此免掉审批，同时**不**放开任何权限位
        annotations: { readOnlyHint: true },
    },
    {
        name: 'fail',
        description: '永远以 isError: true 结束，用于测试「业务层失败」的传递',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'rich',
        description: '返回 text + image + resource 三种内容，用于测试非文本内容的折叠',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'hang',
        description: '收到调用后不作任何响应，用于测试请求超时',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        // 既没有描述也没有 inputSchema：客户端要能退化，而不是崩在缺字段上
        name: 'bare',
    },
];

function send(message) {
    try {
        process.stdout.write(`${JSON.stringify(message)}\n`);
    } catch {
        // 父进程已经不读了（管道关了）：这属于正常收尾，不该让本进程抛栈
    }
}

function respond(id, result) {
    send({ jsonrpc: '2.0', id, result });
}

function respondError(id, code, message) {
    send({ jsonrpc: '2.0', id, error: { code, message } });
}

function handleList(message) {
    const params = message.params ?? {};

    // 永远说「还有下一页」：客户端必须有刹车，否则这里就是个死循环
    if (ALWAYS_MORE) {
        respond(message.id, { tools: TOOLS, nextCursor: 'always-more' });
        return;
    }

    const start = typeof params.cursor === 'string' ? Number(params.cursor) : 0;
    const pageSize = PAGE_SIZE > 0 ? PAGE_SIZE : TOOLS.length;
    const page = TOOLS.slice(start, start + pageSize);
    const next = start + pageSize < TOOLS.length ? String(start + pageSize) : undefined;

    respond(message.id, next === undefined ? { tools: page } : { tools: page, nextCursor: next });
}

function handleCall(message) {
    const params = message.params ?? {};
    const name = params.name;
    const args = params.arguments ?? {};

    switch (name) {
        case 'echo':
            respond(message.id, {
                content: [{ type: 'text', text: `echo: ${args.text ?? ''}\npid: ${process.pid}` }],
            });
            return;
        case 'fail':
            respond(message.id, {
                isError: true,
                content: [{ type: 'text', text: 'boom: 远端工具报告失败' }],
            });
            return;
        case 'rich':
            respond(message.id, {
                content: [
                    { type: 'text', text: 'rich ok' },
                    // 16000 个 base64 字符 = 12000 字节 = 11.7KB，用来断言占位里的体积
                    { type: 'image', mimeType: 'image/png', data: 'A'.repeat(16000) },
                    { type: 'resource', resource: { uri: 'file:///tmp/report.txt', mimeType: 'text/plain' } },
                ],
            });
            return;
        case 'bare':
            respond(message.id, { content: [] });
            return;
        case 'hang':
            // 故意不回：客户端必须自己靠超时收场
            return;
        default:
            respondError(message.id, -32602, `Unknown tool: ${name}`);
    }
}

function handleLine(line) {
    let message;
    try {
        message = JSON.parse(line);
    } catch {
        return;
    }

    // 通知（没有 id）一律不回
    if (message.id === undefined) return;

    switch (message.method) {
        case 'initialize':
            respond(message.id, {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: { name: 'acode-mcp-stub', version: '0.0.1' },
            });
            return;
        case 'tools/list':
            handleList(message);
            return;
        case 'tools/call':
            handleCall(message);
            return;
        default:
            respondError(message.id, -32601, `Method not found: ${message.method}`);
    }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line !== '') handleLine(line);
        index = buffer.indexOf('\n');
    }
});

// 父进程关掉 stdin 就是「该退了」。不认这个，close() 里就得靠信号升级，
// 而残留子进程正是这一节要防的东西。
process.stdin.on('end', () => process.exit(0));

// 一行 stderr：既像真的 server（它们普遍往 stderr 打启动日志），也让测试能断言
// 「server 的 stderr 被逐行交回调用方」这条链路真的通了
process.stderr.write('MCP stub 已启动\n');
