// src/mcp/config.ts
//
// `<工作区>/.acode/mcp.json` 的读取与校验。
//
// 放在 tools 包而不是 CLI：配置形状是 MCP 客户端契约的一部分（谁解析都得知道
// `command` 必填），CLI 只该负责拼路径与展示。
//
// 三条容错约定，都为了「配置写错」与「没配置」不长得一样：
//   - 文件不存在 = 没有配置，不是错误（绝大多数工作区都没有它）；
//   - JSON 坏 / 字段类型不对 = 返回可读的中文错误，**不抛未捕获异常**
//     （抛出去会让 CLI 在启动时带着一段栈崩掉，而用户只是多写了一个逗号）；
//   - 错误信息带文件名与字段路径，用户能直接改。

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 一个 MCP server 的启动方式，形状对齐 MCP 生态里通用的 mcpServers 配置 */
export interface McpServerConfig {
    /** 可执行文件。相对路径按 cwd（配置里的 cwd，或当前进程的工作目录）解析 */
    command: string;
    args?: string[];
    /** 追加到进程环境变量上的键值（不是替换，PATH 等仍然继承） */
    env?: Record<string, string>;
    cwd?: string;
}

export interface McpConfigLoad {
    /** 配置文件路径。无论文件在不在都给出来 —— 提示用户「该在哪写」靠它 */
    file: string;
    /** 解析成功的 server 列表；出错时为空对象 */
    servers: Record<string, McpServerConfig>;
    /** 读不到或解析失败时的中文说明；一切正常时为 null */
    error: string | null;
}

/** 配置文件的固定位置（相对工作区根） */
export function mcpConfigFile(workspaceRoot: string): string {
    return join(workspaceRoot, '.acode', 'mcp.json');
}

/**
 * 读工作区里的 MCP 配置。
 *
 * 永不抛错：调用方（CLI 启动路径）拿到的是「有没有 server」与「为什么没有」，
 * 而不是一个异常。配置坏了不该阻断启动 —— 它只影响 MCP 这一块能力。
 */
export function loadMcpConfig(workspaceRoot: string): McpConfigLoad {
    const file = mcpConfigFile(workspaceRoot);

    if (!existsSync(file)) {
        return { file, servers: {}, error: null };
    }

    let raw: string;
    try {
        raw = readFileSync(file, 'utf8');
    } catch (error) {
        return { file, servers: {}, error: `读取 ${file} 失败：${(error as Error).message}` };
    }

    let parsed: unknown;
    try {
        // 去 BOM：Windows 上的编辑器（尤其记事本）会默默加上它，
        // 而 JSON.parse 对它报的是「意外的字符」这种完全指不到根因的错
        parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch (error) {
        return { file, servers: {}, error: `${file} 不是合法的 JSON：${(error as Error).message}` };
    }

    const problems: string[] = [];
    const servers = collectServers(parsed, problems);

    if (problems.length > 0) {
        return { file, servers: {}, error: `${file} 配置有问题：\n  - ${problems.join('\n  - ')}` };
    }

    return { file, servers, error: null };
}

/**
 * 从顶层对象里挑出 mcpServers。
 *
 * 字段类型不对的一律记进 problems，而不是取个默认值糊过去 —— 后者会让
 * 「命令写错了」表现成「服务起来了但什么都没有」，那比直接报错难查得多。
 */
function collectServers(
    parsed: unknown,
    problems: string[],
): Record<string, McpServerConfig> {
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        problems.push('顶层必须是一个 JSON 对象，形如 { "mcpServers": { ... } }');
        return {};
    }

    const mcpServers = (parsed as Record<string, unknown>).mcpServers;
    if (mcpServers === undefined) {
        problems.push('缺少 mcpServers 字段（应为 { "mcpServers": { "<名字>": { "command": "..." } } }）');
        return {};
    }
    if (mcpServers === null || typeof mcpServers !== 'object' || Array.isArray(mcpServers)) {
        problems.push('mcpServers 必须是一个对象，键是服务名、值是启动方式');
        return {};
    }

    const servers: Record<string, McpServerConfig> = {};
    for (const [name, value] of Object.entries(mcpServers as Record<string, unknown>)) {
        const server = readServer(name, value, problems);
        if (server !== null) servers[name] = server;
    }

    return servers;
}

function readServer(
    name: string,
    value: unknown,
    problems: string[],
): McpServerConfig | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        problems.push(`mcpServers.${name} 必须是对象（至少要有 command）`);
        return null;
    }

    const record = value as Record<string, unknown>;
    let ok = true;

    const command = record.command;
    if (typeof command !== 'string' || command.trim() === '') {
        problems.push(`mcpServers.${name}.command 必须是非空字符串`);
        ok = false;
    }

    let args: string[] | undefined;
    if (record.args !== undefined) {
        if (Array.isArray(record.args) && record.args.every((item) => typeof item === 'string')) {
            args = record.args as string[];
        } else {
            problems.push(`mcpServers.${name}.args 必须是字符串数组`);
            ok = false;
        }
    }

    let env: Record<string, string> | undefined;
    if (record.env !== undefined) {
        if (record.env !== null && typeof record.env === 'object' && !Array.isArray(record.env)
            && Object.values(record.env as Record<string, unknown>).every((item) => typeof item === 'string')) {
            env = record.env as Record<string, string>;
        } else {
            problems.push(`mcpServers.${name}.env 必须是「字符串 → 字符串」的对象`);
            ok = false;
        }
    }

    let cwd: string | undefined;
    if (record.cwd !== undefined) {
        if (typeof record.cwd === 'string' && record.cwd.trim() !== '') {
            cwd = record.cwd;
        } else {
            problems.push(`mcpServers.${name}.cwd 必须是非空字符串`);
            ok = false;
        }
    }

    if (!ok) return null;

    // 未知字段直接忽略：MCP 生态里各家的配置还在长（如 timeout、disabled），
    // 对它们报错只会让用户没法把现成的配置文件抄过来用
    return {
        command: command as string,
        ...(args !== undefined ? { args } : {}),
        ...(env !== undefined ? { env } : {}),
        ...(cwd !== undefined ? { cwd } : {}),
    };
}

/** `/mcp` 与报错里展示的配置示例 */
export const MCP_CONFIG_EXAMPLE = `{
  "mcpServers": {
    "例子": { "command": "npx", "args": ["-y", "@some/mcp-server"] }
  }
}`;
