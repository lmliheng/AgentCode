// src/mcp/connect.ts
//
// 把配置里的一批 MCP server 连起来，产出「可以直接并进工具数组」的工具列表。
//
// 这里最重要的性质是**隔离**：一个 server 起不来（命令不存在、依赖没装、
// 握手超时）不能让其他 server 一起失败，更不能让 CLI 起不来。用户配了三个
// server，其中一个写错名字是常态，为它把整个会话废掉没有任何道理。

import type { Tool, ToolParams } from '@lmliheng/acode-core';

import { McpClient } from './client.js';
import { McpTool, uniqueMcpToolName } from './tool.js';
import type { McpServerConfig } from './config.js';

export interface McpConnectOptions {
    /** 单条请求超时（毫秒），默认见 client.ts */
    requestTimeoutMs?: number;
    /** server 的日志行（stderr 与它误打到 stdout 的内容） */
    onLog?: (server: string, line: string) => void;
    /** 某个 server 连接/列工具失败。同时也会记进返回值的 failures */
    onError?: (server: string, message: string) => void;
}

/** 一个连上的 server 与它提供的工具（名字是本地注册用的那个） */
export interface McpConnectedServer {
    server: string;
    tools: { remote: string; name: string; description: string }[];
}

export interface McpConnectionSet {
    /** 可以直接并进工具数组的远程工具 */
    tools: Tool<ToolParams>[];
    /** 连接成功的 server 名 */
    servers: string[];
    /** 连接失败的 server 与原因（不抛错，交给调用方决定怎么展示） */
    failures: { server: string; message: string }[];
    /** 连上的 server → 工具清单，供 /mcp 这类展示用 */
    connections: McpConnectedServer[];
    /**
     * 断开全部连接。幂等，且不抛错 —— 它总在 finally/退出路径上被调用，
     * 在那里抛出的异常会把真正的原因盖掉。
     */
    close: () => Promise<void>;
}

/**
 * 并发连接全部 server，为一个缺省配置（undefined / 空对象）时直接返回空集。
 */
export async function connectMcpServers(
    servers: Record<string, McpServerConfig>,
    opts: McpConnectOptions = {},
): Promise<McpConnectionSet> {
    const names = Object.keys(servers);
    if (names.length === 0) {
        return { tools: [], servers: [], failures: [], connections: [], close: async () => {} };
    }

    const failures: { server: string; message: string }[] = [];
    const connections: McpConnectedServer[] = [];
    const tools: Tool<ToolParams>[] = [];
    const clients: McpClient[] = [];
    const usedNames = new Set<string>();

    // 并发而不是串行：一个 server 起得慢（npx 拉包）不该让后面的一起等
    const results = await Promise.all(names.map(async (name) => {
        const config = servers[name] as McpServerConfig;
        try {
            const client = await McpClient.connect(name, config, {
                ...(opts.requestTimeoutMs !== undefined ? { requestTimeoutMs: opts.requestTimeoutMs } : {}),
                onLog: (line) => opts.onLog?.(name, line),
            });
            return { name, client };
        } catch (error) {
            return { name, message: (error as Error).message };
        }
    }));

    for (const result of results) {
        if (result.client === undefined) {
            const message = result.message ?? '连接失败';
            failures.push({ server: result.name, message });
            opts.onError?.(result.name, message);
            continue;
        }

        // 连上之后第一件事就是列工具：连得上却列不出工具的 server 对本应用没有用处，
        // 在这里停下来，比让它在工具表里留一堆空位好
        let remoteTools;
        try {
            remoteTools = await result.client.listTools();
        } catch (error) {
            const message = (error as Error).message;
            failures.push({ server: result.name, message });
            opts.onError?.(result.name, message);
            await result.client.close();
            continue;
        }

        const registered: McpConnectedServer['tools'] = [];
        for (const tool of remoteTools) {
            const name = uniqueMcpToolName(result.name, tool.name, usedNames);
            tools.push(new McpTool({
                server: result.name,
                remoteName: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
                readOnly: tool.readOnly,
                name,
                client: result.client,
            }));
            registered.push({ remote: tool.name, name, description: tool.description });
        }

        clients.push(result.client);
        connections.push({ server: result.name, tools: registered });
    }

    return {
        tools,
        servers: connections.map((connection) => connection.server),
        failures,
        connections,
        close: async () => {
            // 收尾阶段的问题只记不抛：close() 总在退出路径上，扔出异常会把
            // 调用方真正想报的错盖掉，而残留进程的可见性靠这里的回调兜底
            await Promise.all(clients.map(async (client) => {
                try {
                    await client.close();
                } catch (error) {
                    opts.onError?.(client.serverName, (error as Error).message);
                }
            }));
        },
    };
}
