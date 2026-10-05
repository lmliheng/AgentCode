// src/mcp/protocol.ts
//
// MCP（Model Context Protocol）协议里本客户端真正用到的那几个形状，以及把
// 远端回来的未知 JSON 收成类型化对象的解析函数。
//
// 单独成模块的理由：协议形状（client.ts 要发、tool.ts 要读）是两边共用的契约，
// 放进任一边都会让另一边绕一圈 import。
//
// 解析一律「宽进严出」：远端是别人的进程，字段缺失、类型不对都不该让本地抛异常，
// 拿不到就退化成默认值，只有「这个工具根本没有名字」这种没法用的情况才判为空。

/** 定死一个双方都认的协议版本；用最新版去赌 server 支持，输的是整个连接 */
export const MCP_PROTOCOL_VERSION = '2024-11-05';

/**
 * 客户端自报的版本号。
 *
 * 写死而不是读 package.json：这个值只进 server 的日志，不参与任何协商，
 * 而按路径去读包根目录在「源码直跑 / dist 产物 / 被打包」三种形态下各不一样，
 * 为一行日志引入一处路径假设不划算。
 */
export const MCP_CLIENT_VERSION = '1.0.0';

/** clientInfo.name：server 侧日志里显示的名字 */
export const MCP_CLIENT_NAME = 'acode';

/** tools/list 的一个条目，收成本地要用的形状 */
export interface McpRemoteTool {
    /** 远端工具名（未经命名空间化） */
    name: string;
    description: string;
    /** 远端给的 JSON Schema；它没给时为 undefined，由调用方退化 */
    inputSchema: Record<string, unknown> | undefined;
    /**
     * 远端自己声明的「只读」提示（annotations.readOnlyHint）。
     *
     * 注意它是**远端自称**，不是我们验证过的事实 —— 所以它只用来决定「要不要
     * 问一声审批」，不用来放开任何读写权限（见 tool.ts 的 permissions）。
     */
    readOnly: boolean;
}

/** tools/call 的结果 */
export interface McpToolCallResult {
    /** content 数组，原样保留（元素形状由 protocol 侧决定，渲染在 tool.ts） */
    content: unknown[];
    /** 远端报告这次调用失败（注意：协议层成功、业务层失败，两个层面要分开） */
    isError: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

/**
 * 解析 tools/list 里的一个条目。
 *
 * 只有「名字是非空字符串」这一条是硬要求 —— 没有名字的工具无法注册、也无法调用，
 * 留着它只会在注册表里占一个永远失败的坑位。其余字段缺失一律降级。
 */
export function parseRemoteTool(entry: unknown): McpRemoteTool | null {
    const record = asRecord(entry);
    if (record === null) return null;

    const name = record.name;
    if (typeof name !== 'string' || name.trim() === '') return null;

    const annotations = asRecord(record.annotations);
    const schema = asRecord(record.inputSchema);

    return {
        name,
        description: typeof record.description === 'string' ? record.description : '',
        inputSchema: schema ?? undefined,
        readOnly: annotations?.readOnlyHint === true,
    };
}

/**
 * 解析 tools/call 的返回值。
 *
 * content 不是数组时给空数组而不是报错：空的 content 配上 isError 仍然是有效的
 * 失败信息（有些 server 就这么干），而报错会把「远端说了失败」变成「我们解析失败」，
 * 那才是真的把信息弄丢了。
 */
export function parseToolCallResult(result: unknown): McpToolCallResult {
    const record = asRecord(result);
    if (record === null) return { content: [], isError: false };

    return {
        content: Array.isArray(record.content) ? record.content : [],
        isError: record.isError === true,
    };
}
