// src/mcp/tool.ts
//
// 把远端 MCP 工具包成 acode 的 Tool。
//
// 命名空间化（`mcp__<server>__<tool>`）不是装饰：工具名同时是模型侧的 function name
// 与本地注册表的键，两个 server 各有一个叫 `search` 的工具时必须区分得开。
// provider 只接受 `[A-Za-z0-9_-]`，所以名字里的非法字符要替换掉。

import type {
    OutputBudget,
    Tool,
    ToolContext,
    ToolParams,
    ToolPermissions,
    ToolResult,
    ValidationResult,
} from '@lmliheng/acode-core';

import type { McpClient } from './client.js';

/** 工具名前缀：一眼能看出这是外部来的能力，也方便按前缀做白名单 */
export const MCP_TOOL_PREFIX = 'mcp__';

/**
 * 把一段名字收进 provider 允许的字符集。
 *
 * 远端工具名不受我们控制（合法字符比 function name 宽得多），
 * 直接拼进工具名会让请求被 provider 打回来 —— 而那看起来像「模型调用失败」，
 * 完全指不到根因。
 */
export function sanitizeNameSegment(segment: string): string {
    const cleaned = segment.replace(/[^A-Za-z0-9_-]/g, '_');
    return cleaned === '' ? '_' : cleaned;
}

/** `<server>` 与 `<tool>` 各自收干净后拼成工具名 */
export function mcpToolName(server: string, remoteTool: string): string {
    return `${MCP_TOOL_PREFIX}${sanitizeNameSegment(server)}__${sanitizeNameSegment(remoteTool)}`;
}

/**
 * 在 `used` 里取一个没被占用的工具名，并把它记进 `used`。
 *
 * 撞名有两个来源：字符替换之后重名（`my.tool` 与 `my_tool`），以及两个 server
 * 名字只差非法字符。撞了就给后者加数字后缀，而不是覆盖前者 —— 覆盖会让模型
 * 看到两个工具名、实际只有一个能调，能调的是哪一个全看运气。
 */
export function uniqueMcpToolName(server: string, remoteTool: string, used: Set<string>): string {
    const base = mcpToolName(server, remoteTool);
    let name = base;
    let suffix = 2;
    while (used.has(name)) {
        name = `${base}_${suffix}`;
        suffix += 1;
    }
    used.add(name);
    return name;
}

export interface McpToolInit {
    /** 配置里的 server 名 */
    server: string;
    /** 远端工具名（原样，调用时要发这个） */
    remoteName: string;
    /** 远端给的描述，原样进模型上下文 */
    description?: string | undefined;
    /** 远端给的 JSON Schema */
    inputSchema?: Record<string, unknown> | undefined;
    /** 远端自称只读（annotations.readOnlyHint） */
    readOnly?: boolean;
    client: McpClient;
    /** 覆盖自动生成的工具名；仅在重名需要加后缀时由装配方传入 */
    name?: string | undefined;
}

export class McpTool implements Tool<ToolParams> {
    readonly name: string;
    readonly description: string;
    readonly permissions: ToolPermissions;

    /**
     * 保守的输出预算。
     *
     * 远端返回多少由它自己决定（有的 server 一次回整张表），而这份文本要原样进
     * 上下文，所以不能声明「不限」—— 声明了，一个话多的 server 就能把上下文吃掉。
     * 这个量级与 read_file / glob 同档。
     */
    readonly outputBudget: OutputBudget = { maxChars: 12_000, maxLines: 400 };

    private readonly server: string;
    private readonly remoteName: string;
    private readonly client: McpClient;
    private readonly schema: Record<string, unknown>;

    constructor(init: McpToolInit) {
        this.server = init.server;
        this.remoteName = init.remoteName;
        this.client = init.client;
        this.name = init.name ?? mcpToolName(init.server, init.remoteName);

        // 远端的 inputSchema 本来就是 JSON Schema —— 模型侧要的也是这一套，
        // 中间不做任何翻译（翻译一次就多一处可能不一致的地方）。
        // 它没给 schema 时退化成「任意对象」：宁可让模型传它以为的参数、
        // 由远端自己校验，也好过在这里编一个假的参数表。
        this.schema = init.inputSchema ?? { type: 'object', properties: {} };

        this.description = composeDescription(
            this.name,
            init.server,
            init.remoteName,
            init.description ?? '',
        );

        /**
         * 权限与审批的取舍：
         *
         * 远端工具的能力对我们是未知的 —— 它可能改文件、跑命令、联网，也可能什么
         * 都不做，而 MCP 协议没有任何字段能保证这一点。所以四个权限位一律 false
         * （声称 false 表示「本地不替它担保任何权限」），并且**默认要求审批**：
         * 首次用到某个外部能力时问一声，比事后发现它删了东西强。
         *
         * 唯一的例外是远端明确声明 readOnlyHint === true。注意这是**远端自称**，
         * 我们没有验证手段，所以它只用来免掉审批（少打扰），不用来放开任何权限位。
         */
        const trustedReadOnly = init.readOnly === true;
        this.permissions = {
            readsFiles: false,
            writesFiles: false,
            runsShell: false,
            requiresApproval: !trustedReadOnly,
        };
    }

    getSchema(): Record<string, unknown> {
        return this.schema;
    }

    /**
     * 校验只做一件事：拒绝不是对象的参数。
     *
     * 其余一律原样通过 —— 参数 schema 是远端给的，校验也应当由远端做（它才是
     * 真正认识这些参数的一方）。本地按 schema 复刻一遍校验，只会得到一个
     * 「本地以为不合法、远端其实接受」的中间层。
     */
    validate(params: unknown): ValidationResult {
        if (params === null || typeof params !== 'object' || Array.isArray(params)) {
            return {
                valid: false,
                errors: ['参数必须是对象（具体的参数 schema 由远端 MCP 服务提供，见本工具的 JSON Schema）'],
                sanitized: {},
            };
        }

        return { valid: true, errors: [], sanitized: params };
    }

    async execute(params: ToolParams, _ctx: ToolContext): Promise<ToolResult> {
        const args = (params ?? {}) as Record<string, unknown>;
        const where = `MCP ${this.server} 的 ${this.remoteName}`;

        try {
            const result = await this.client.callTool(this.remoteName, args);
            const text = renderContent(result.content);

            // 协议层成功 ≠ 业务层成功：MCP 用 isError 表达后者，必须分开对待，
            // 否则远端明明报了失败，模型看到的却是一次「成功」，接着往下做错事。
            if (result.isError) {
                return {
                    success: false,
                    data: null,
                    error: text === '' ? `${where} 报告失败，但没有给出说明` : text,
                    display: `${where} 报告失败`,
                };
            }

            return {
                success: true,
                data: text,
                display: `${where} 返回 ${result.content.length} 段内容`,
            };
        } catch (error) {
            // 超时、连接断开、远端返回 JSON-RPC error 都到这里 —— 对模型来说是同一件事：
            // 这次调用没成，以及为什么。异常不能穿透到运行时，那会变成「工具炸了」。
            return {
                success: false,
                data: null,
                error: `${where} 调用失败：${(error as Error).message}`,
                display: `${where} 调用失败`,
            };
        }
    }
}

function composeDescription(
    localName: string,
    server: string,
    remoteName: string,
    remoteDescription: string,
): string {
    const body = remoteDescription.trim() === ''
        ? '（该 MCP 工具没有提供描述）'
        : remoteDescription.trim();

    return `${body}

来源：外部 MCP 服务 "${server}" 的工具 ${remoteName}（在本工具表里叫 ${localName}）。
它的能力与副作用由该服务自己决定，不在本工具的描述范围内：可能改文件、联网或起进程，也可能什么都不做。`;
}

/**
 * 把 tools/call 的 content 数组折成一段文本。
 *
 * **非 text 的内容一律折成占位说明，不原样交给模型。** 原因是后端的现实：
 * DeepSeek 的对话接口不接受多模态输入，一段 base64 图片塞进 content 只会
 * 变成一堆占巨大的、模型看不懂的字符 —— 既污染上下文，又让「有一次图片返回」
 * 这件事完全不可见。折成 `[image: image/png, 12.3KB]` 之后，模型至少知道
 * 「这里有一张图，我看不到它」，人也知道该去远端那边看。
 */
export function renderContent(content: readonly unknown[]): string {
    const parts: string[] = [];

    for (const item of content) {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) {
            parts.push(String(item));
            continue;
        }

        const record = item as Record<string, unknown>;
        const type = typeof record.type === 'string' ? record.type : 'unknown';

        switch (type) {
            case 'text':
                if (typeof record.text === 'string') parts.push(record.text);
                break;
            case 'image':
                parts.push(describeBinary('image', record));
                break;
            case 'audio':
                parts.push(describeBinary('audio', record));
                break;
            case 'resource':
                parts.push(describeResource(record.resource));
                break;
            default:
                parts.push(`[${type}: 该内容类型无法在此展示]`);
        }
    }

    return parts.join('\n');
}

function describeBinary(kind: 'image' | 'audio', record: Record<string, unknown>): string {
    const mimeType = typeof record.mimeType === 'string' ? record.mimeType : '未知类型';
    const data = typeof record.data === 'string' ? record.data : '';
    const size = data === '' ? '' : `, ${formatBytes(base64Size(data))}`;
    return `[${kind}: ${mimeType}${size}]`;
}

/**
 * resource 也折成占位。
 *
 * 内嵌文本的 resource（`resource.text`）其实可以原样给模型，但它的体积不可控
 * （有的 server 会把整个文件塞进来），而这里没有做截断的位置；先给个能看出
 * 「远端返回了资源、需要另取」的占位，比默默塞进一段几千行的正文安全。
 */
function describeResource(resource: unknown): string {
    if (resource === null || typeof resource !== 'object' || Array.isArray(resource)) {
        return '[resource: 内容无法识别]';
    }

    const record = resource as Record<string, unknown>;
    const uri = typeof record.uri === 'string' ? record.uri : '未知 URI';
    const mimeType = typeof record.mimeType === 'string' ? ` (${record.mimeType})` : '';
    const size = typeof record.text === 'string'
        ? `, 内嵌文本 ${formatBytes(record.text.length)}`
        : '';

    return `[resource: ${uri}${mimeType}${size}]`;
}

/** base64 解码后的字节数：按 4 字符 3 字节算，再扣掉末尾的填充 */
function base64Size(data: string): number {
    const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
