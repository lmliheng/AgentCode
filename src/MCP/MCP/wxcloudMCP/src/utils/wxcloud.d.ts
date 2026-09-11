import type { WxCloudResult } from '../types.js';
/** @wxcloud/cli 的 bin 入口 */
export declare const WXCLI_BIN: string;
export declare function runWxCloud(args: string[], timeoutMs?: number): Promise<WxCloudResult>;
export declare function runWxCloudJson(args: string[], timeoutMs?: number): Promise<{
    data: unknown;
    stderr: string;
}>;
export interface ToolContent {
    type: 'text';
    text: string;
}
export interface ToolResult {
    content: ToolContent[];
    isError?: boolean;
    structuredContent?: unknown;
    [key: string]: unknown;
}
export declare function okResult(text: string, structured?: unknown): ToolResult;
export declare function errorResult(message: string): ToolResult;
/** 尽量返回 JSON；解析失败回退为原始文本 */
export declare function jsonOrRaw(args: string[], timeoutMs?: number): Promise<ToolResult>;
