// src/mcp/client.ts
//
// MCP（Model Context Protocol）stdio 客户端。零依赖，只用 node 内置模块 ——
// 这个仓库的取向是 core「零依赖地基」、tools 只依赖 core，为几十行 JSON-RPC
// 背上官方 SDK 那棵依赖树不划算。
//
// **传输形态是 JSON-RPC 2.0「换行分隔」**：一行一条 JSON。这一点最容易踩坑 ——
// 它和 LSP 的 Content-Length 分帧长得很像，但按 Content-Length 去解一个 stdio
// MCP server 会一条消息都读不出来：表面现象是「工具列表永远是空的」，而且不报错。
//
// 三条生命周期约定，后面各方法都围绕它们写：
//   1. 每条请求都有超时。远端卡住时宁可失败，也不能让 CLI 永远挂着。
//   2. 响应按 id 配对，允许并发在途请求（initialize 之后再并发 tools/list）。
//   3. 子进程一退出，所有在途请求立刻以「连接已断开 + 退出码」失败收场 ——
//      否则它们既等不到响应、也不到期，就成了永远挂着的 Promise。

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import {
    MCP_CLIENT_NAME,
    MCP_CLIENT_VERSION,
    MCP_PROTOCOL_VERSION,
    parseRemoteTool,
    parseToolCallResult,
} from './protocol.js';
import type { McpRemoteTool, McpToolCallResult } from './protocol.js';
import type { McpServerConfig } from './config.js';

/** 默认请求超时。远端工具可能真在干重活，所以给得比一次 HTTP 请求宽 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

/** close() 里 SIGTERM 之后的宽限期，超时再上 SIGKILL */
const CLOSE_GRACE_MS = 2_000;
/** SIGKILL 之后再等一小会儿确认收尸，纯粹为了让「进程确实没了」可断言 */
const CLOSE_KILL_WAIT_MS = 1_000;

/** tools/list 的分页上限。远端 bug 导致 nextCursor 一直返回时，这里是唯一的刹车 */
const MAX_TOOL_PAGES = 50;

export interface McpClientOptions {
    /** 单条请求的超时（毫秒），默认 DEFAULT_REQUEST_TIMEOUT_MS */
    requestTimeoutMs?: number;
    /**
     * server 的 stderr（以及它误打到 stdout 的非 JSON 行）逐行交给调用方。
     *
     * 不自己写 stdout/stderr：本库既要给交互式 CLI 用，也要给 headless 用，
     * 而 headless 的 stdout 只能有 JSON，库替调用方决定输出落点是错的设计。
     */
    onLog?: (line: string) => void;
}

interface PendingRequest {
    method: string;
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

export class McpClient {
    /** 连接用的名字（配置里的 server 名），只用于日志与报错 */
    readonly serverName: string;

    private readonly timeoutMs: number;
    private readonly onLog: ((line: string) => void) | undefined;

    private readonly child: ChildProcess;
    private readonly pending = new Map<number, PendingRequest>();

    private nextId = 1;
    private stdoutBuffer = '';
    private stderrBuffer = '';

    /** 子进程退出后的描述（「退出码 1」/「被信号 SIGTERM 终止」），未退出时为 null */
    private exitDescription: string | null = null;
    /** 调用方主动 close() 过 */
    private closeRequested = false;

    private constructor(serverName: string, config: McpServerConfig, options: McpClientOptions) {
        this.serverName = serverName;
        this.timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        this.onLog = options.onLog;

        try {
            this.child = spawn(config.command, config.args ?? [], {
                // env 是**合并**而不是替换：配置里通常只写自己那几个变量，
                // 整份替换会把 PATH 一起弄丢，于是 `command: 'node'` 就找不到了。
                env: { ...process.env, ...config.env },
                cwd: config.cwd,
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true,
            });
        } catch (error) {
            throw new Error(`启动 MCP server ${serverName} 失败：${(error as Error).message}`);
        }

        this.wireStreams();
        this.wireExit();
    }

    /**
     * 起进程并完成握手。任何一步失败都抛错，调用方据此把该 server 记进 failures。
     */
    static async connect(
        serverName: string,
        config: McpServerConfig,
        options: McpClientOptions = {},
    ): Promise<McpClient> {
        const client = new McpClient(serverName, config, options);
        try {
            await client.waitForSpawn();
            await client.initialize();
        } catch (error) {
            // 握手没成的进程不能留在后台：它是这次调用自己起的，得自己收掉
            await client.close();
            throw error;
        }
        return client;
    }

    /** 子进程是否已经退出 */
    get exited(): boolean {
        return this.exitDescription !== null;
    }

    /**
     * 握手：initialize 请求 + notifications/initialized 通知。
     *
     * 第二步必须是**通知**（没有 id、不等回复）：协议规定的顺序是 server 收到它
     * 才算初始化完成，在这里等回复会直接挂到超时。
     */
    private async initialize(): Promise<void> {
        await this.request('initialize', {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION },
        });
        this.notify('notifications/initialized', {});
    }

    /**
     * 列出远端全部工具，循环取完 nextCursor 分页。
     *
     * 分页必须真跟到底：MCP server 常见的实现是按固定页大小返回的，
     * 只看第一页会**静默**少掉一部分工具 —— 模型于是永远不知道它们存在。
     */
    async listTools(): Promise<McpRemoteTool[]> {
        const tools: McpRemoteTool[] = [];
        const seen = new Set<string>();
        let cursor: string | undefined;

        for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
            const result = await this.request(
                'tools/list',
                cursor === undefined ? {} : { cursor },
            );

            const record = result !== null && typeof result === 'object'
                ? result as Record<string, unknown>
                : {};

            if (Array.isArray(record.tools)) {
                for (const entry of record.tools) {
                    const tool = parseRemoteTool(entry);
                    // 同名工具只登记第一次：既防远端重复，也防分页实现有问题时越取越多
                    if (tool !== null && !seen.has(tool.name)) {
                        seen.add(tool.name);
                        tools.push(tool);
                    }
                }
            }

            const next = record.nextCursor;
            // 没有 nextCursor 就是取完了，这是唯一的正常出口
            if (typeof next !== 'string' || next === '') return tools;
            cursor = next;
        }

        // 走到这里说明撞上了页数上限（多半是远端一直回同一个 nextCursor）。
        // 静默截断是这里最坏的选择：用户只会看到「少了一部分工具」，无从归因。
        this.log(`[警告] tools/list 分页超过 ${MAX_TOOL_PAGES} 页，只登记了前 ${tools.length} 个工具`);
        return tools;
    }

    /** 调用远端工具。协议层出错（含远端返回 JSON-RPC error）在这里抛 */
    async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
        const result = await this.request('tools/call', { name, arguments: args });
        return parseToolCallResult(result);
    }

    /**
     * 断开：关 stdin（多数 server 读到 EOF 自己退）→ SIGTERM → 宽限后 SIGKILL。
     *
     * 必须能收干净：CLI 退出后残留的子进程会占着端口、开着文件，
     * 而用户看到的只是「这个工具好像有点卡」，根本联想不到上一次运行留下的东西。
     */
    async close(): Promise<void> {
        if (this.closeRequested) return;
        this.closeRequested = true;

        this.failPending(`MCP server ${this.serverName} 已关闭（调用方主动断开）`);
        if (this.exited) return;

        // 连 pid 都没有，说明进程根本没起来（命令不存在之类）。这里没有可收的东西，
        // 更要紧的是不能去等 exit 事件 —— 它永远不会来，于是每次连接失败都要白等
        // 一个完整的宽限期，把「工具起不来」拖成「CLI 启动很慢」。
        if (this.child.pid === undefined) return;

        try {
            this.child.stdin?.end();
        } catch {
            // 已经关掉了：继续往下走，SIGTERM 才是最后一道
        }

        this.kill('SIGTERM');
        if (await this.waitForExit(CLOSE_GRACE_MS)) return;

        this.kill('SIGKILL');
        await this.waitForExit(CLOSE_KILL_WAIT_MS);
    }

    // -----------------------------------------------------------------------
    // 进程与流的接线
    // -----------------------------------------------------------------------

    private wireStreams(): void {
        const { stdout, stderr } = this.child;

        // setEncoding：多字节字符（中文）可能被切在两次 data 之间，
        // 不按 utf8 解码会拼出乱码，而 JSON.parse 又恰好会失败 —— 于是表现为
        // 「工具描述偶尔变成乱码日志」这种最难复现的 bug。
        stdout?.setEncoding('utf8');
        stderr?.setEncoding('utf8');

        stdout?.on('data', (chunk: string) => {
            this.consumeStdout(chunk);
        });

        stderr?.on('data', (chunk: string) => {
            this.stderrBuffer += chunk;
            let index = this.stderrBuffer.indexOf('\n');
            while (index !== -1) {
                const line = this.stderrBuffer.slice(0, index);
                this.stderrBuffer = this.stderrBuffer.slice(index + 1);
                if (line.trim() !== '') this.log(line.replace(/\r$/, ''));
                index = this.stderrBuffer.indexOf('\n');
            }
        });
    }

    private wireExit(): void {
        this.child.once('exit', (code, signal) => {
            this.exitDescription = signal !== null ? `被信号 ${signal} 终止` : `退出码 ${code ?? 'null'}`;
            // 在途请求以「连接已断开」收场：进程没了，响应永远不会来，
            // 不在这里 reject，那些 Promise 就成了永远挂着的黑洞
            this.failPending(this.disconnectedMessage());
        });

        // 'error' 既覆盖异步的启动失败（ENOENT），也覆盖运行期的进程错误。
        // 这里只记日志：启动失败由 waitForSpawn 负责 reject，运行期错误由 exit 收尾。
        this.child.on('error', (error) => {
            this.log(`[进程错误] ${error.message}`);
        });
    }

    private waitForSpawn(): Promise<void> {
        if (this.child.pid !== undefined) {
            // 已经拿到 pid 说明 spawn 成功（pid 在 spawn(2) 成功后就同步可读）
            return Promise.resolve();
        }

        return new Promise<void>((resolve, reject) => {
            const onSpawn = (): void => {
                cleanup();
                resolve();
            };
            const onError = (error: Error): void => {
                cleanup();
                reject(new Error(`启动 MCP server ${this.serverName} 失败：${error.message}`));
            };
            const cleanup = (): void => {
                this.child.removeListener('spawn', onSpawn);
                this.child.removeListener('error', onError);
            };

            this.child.once('spawn', onSpawn);
            this.child.once('error', onError);
        });
    }

    /**
     * 等待进程退出。用事件而不是轮询：轮询在「进程立刻退出」的常见情形下
     * 只是白白多等一个间隔。
     */
    private waitForExit(timeoutMs: number): Promise<boolean> {
        if (this.exited) return Promise.resolve(true);

        return new Promise<boolean>((resolve) => {
            const onExit = (): void => {
                clearTimeout(timer);
                resolve(true);
            };
            const timer = setTimeout(() => {
                this.child.removeListener('exit', onExit);
                resolve(false);
            }, timeoutMs);

            this.child.once('exit', onExit);
        });
    }

    private kill(signal: NodeJS.Signals): void {
        try {
            this.child.kill(signal);
        } catch {
            // 已经退出、或没权限：close() 是收尾动作，不该在这里抛
        }
    }

    // -----------------------------------------------------------------------
    // JSON-RPC
    // -----------------------------------------------------------------------

    private request(method: string, params: Record<string, unknown>): Promise<unknown> {
        if (this.exited) {
            return Promise.reject(new Error(this.disconnectedMessage()));
        }

        const id = this.nextId;
        this.nextId += 1;

        return new Promise<unknown>((resolve, reject) => {
            // 允许并发在途：id 配对，不是「一次一条」的队列
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(
                    `MCP server ${this.serverName} 的 ${method} 请求超时` +
                    `（>${this.timeoutMs}ms，可用 requestTimeoutMs 调整）`,
                ));
            }, this.timeoutMs);

            this.pending.set(id, { method, resolve, reject, timer });

            try {
                this.write({ jsonrpc: '2.0', id, method, params });
            } catch (error) {
                this.settle(id, error as Error);
            }
        });
    }

    private notify(method: string, params: Record<string, unknown>): void {
        if (this.exited) return;
        try {
            this.write({ jsonrpc: '2.0', method, params });
        } catch {
            // 通知没有回执，放弃它是安全的：connection 已经断了，调用方马上会从
            // 下一条请求的失败里知道这件事
        }
    }

    private write(message: unknown): void {
        const stdin = this.child.stdin;
        if (stdin === null || stdin.destroyed || !stdin.writable) {
            throw new Error(this.disconnectedMessage());
        }
        // 换行分隔：一条消息一行，写完必须换行，否则对端会一直等这一条的结尾
        stdin.write(`${JSON.stringify(message)}\n`);
    }

    private consumeStdout(chunk: string): void {
        this.stdoutBuffer += chunk;

        let index = this.stdoutBuffer.indexOf('\n');
        while (index !== -1) {
            const line = this.stdoutBuffer.slice(0, index);
            this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
            this.dispatchLine(line);
            index = this.stdoutBuffer.indexOf('\n');
        }
    }

    private dispatchLine(rawLine: string): void {
        const line = rawLine.replace(/\r$/, '').trim();
        if (line === '') return;

        let message: unknown;
        try {
            message = JSON.parse(line);
        } catch {
            // 有 server 会把日志（或 banner）打到 stdout。这既不是协议错误，也不能
            // 当成「收到一条坏消息」丢掉：转成日志交出去，协议消息照常解析。
            // stdout 被污染时，这里是唯一能看见原因的入口。
            this.log(line);
            return;
        }

        this.dispatch(message);
    }

    private dispatch(message: unknown): void {
        if (message === null || typeof message !== 'object' || Array.isArray(message)) {
            this.log('[无法解析的消息] 不是 JSON 对象');
            return;
        }

        const record = message as Record<string, unknown>;
        const id = record.id;

        if (id === undefined) {
            // server → client 通知：本客户端没有订阅任何通知，记一笔即可
            if (typeof record.method === 'string') this.log(`[通知] ${record.method}`);
            return;
        }

        if (typeof record.method === 'string') {
            // server 反过来请求客户端（sampling / roots 之类）。本客户端不具备这些
            // 能力，但**必须回一个错误**：不回，对端会一直等，表现为「工具调用永远不返回」。
            this.replyUnsupported(id, record.method);
            return;
        }

        const pending = this.pending.get(Number(id));
        // 超时之后才姗姗来迟的响应，丢弃即可
        if (pending === undefined) return;

        this.pending.delete(Number(id));
        clearTimeout(pending.timer);

        if (record.error !== undefined) {
            pending.reject(new Error(`MCP server ${this.serverName} 返回错误：${describeRpcError(record.error)}`));
            return;
        }

        pending.resolve(record.result);
    }

    private replyUnsupported(id: unknown, method: string): void {
        try {
            this.write({
                jsonrpc: '2.0',
                id,
                error: { code: -32601, message: `acode MCP 客户端不支持 server 发起的请求：${method}` },
            });
        } catch {
            // 连接已经断了，对方自然会超时
        }
    }

    private settle(id: number, error: Error): void {
        const pending = this.pending.get(id);
        if (pending === undefined) return;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        pending.reject(error);
    }

    private failPending(message: string): void {
        const waiters = [...this.pending.values()];
        this.pending.clear();
        for (const waiter of waiters) {
            clearTimeout(waiter.timer);
            waiter.reject(new Error(message));
        }
    }

    private disconnectedMessage(): string {
        if (this.exitDescription !== null) {
            return `MCP server ${this.serverName} 的连接已断开（子进程${this.exitDescription}）`;
        }
        return `MCP server ${this.serverName} 的连接已不可用`;
    }

    private log(line: string): void {
        this.onLog?.(line);
    }
}

function describeRpcError(error: unknown): string {
    if (error === null || typeof error !== 'object' || Array.isArray(error)) return String(error);
    const record = error as Record<string, unknown>;
    const message = typeof record.message === 'string' ? record.message : JSON.stringify(error);
    return typeof record.code === 'number' ? `${message}（code ${record.code}）` : message;
}
