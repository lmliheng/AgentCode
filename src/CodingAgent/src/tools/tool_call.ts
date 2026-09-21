// src/tools/tool_call.ts
//
// 调用延迟工具的桥。与 qwen-code 的 ToolCallTool 一样，它**自己不执行工具**：
// 真正的解包发生在运行时派发处，这样目标工具才能保留它自己的参数校验、审批、
// 输出预算与超时（在工具内部直接执行会绕开这些）。

import type { Tool, ToolParams, ToolContext, ToolResult, ValidationResult } from '../types/Tool.js';
import { TOOL_CALL, TOOL_SEARCH } from './deferred.js';

export interface ToolCallParams extends ToolParams {
    /** 延迟工具的确切名称 */
    name: string;
    /** 符合该工具 schema 的参数 */
    arguments: Record<string, unknown>;
}

/**
 * 本工具会执行、但必须由运行时接管，所以给出明确的拒绝原因，
 * 而不是静默返回到一个假的成功结果。
 */
const DISPATCH_REQUIRED =
    'tool_call 必须经 AgentRuntime 派发：只有这样才能让被调用的工具保留自己的参数校验、审批与输出预算。';

export class ToolCallTool implements Tool<ToolCallParams> {
    readonly name = TOOL_CALL;
    readonly description = `在看过某个延迟工具的 schema 之后调用它。

- 传确切的延迟工具名与符合该 schema 的参数。
- 只接受延迟工具；已在工具列表里的工具请直接调用，不要经本工具绕一次。
- 权限与审批对被调用的工具照常生效。`;
    readonly permissions = {
        readsFiles: false,
        writesFiles: false,
        runsShell: false,
        requiresApproval: false,
    };

    validate(params: unknown): ValidationResult {
        const errors: string[] = [];
        const input = (params ?? {}) as Record<string, unknown>;

        const name = input['name'];
        if (typeof name !== 'string' || name.trim() === '') {
            errors.push('name 必须是非空字符串（延迟工具的确切名称）');
        } else if (name === TOOL_CALL || name === TOOL_SEARCH) {
            errors.push(`${name} 不能作为 tool_call 的目标：桥工具本身就是声明的，直接调用即可`);
        }

        const args = input['arguments'];
        if (args === null || typeof args !== 'object' || Array.isArray(args)) {
            errors.push('arguments 必须是对象（符合目标工具的 schema）');
        }

        return {
            valid: errors.length === 0,
            errors,
            sanitized: {
                name: typeof name === 'string' ? name.trim() : '',
                arguments: (args ?? {}) as Record<string, unknown>,
            },
        };
    }

    async execute(_params: ToolCallParams, _ctx: ToolContext): Promise<ToolResult> {
        return { success: false, data: null, error: DISPATCH_REQUIRED };
    }

    getSchema(): Record<string, unknown> {
        return {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: '延迟工具的确切名称（tool_search 返回的 name）。',
                    minLength: 1,
                },
                arguments: {
                    type: 'object',
                    description: '符合 tool_search 返回的该工具参数 schema 的参数对象。',
                },
            },
            required: ['name', 'arguments'],
            additionalProperties: false,
        };
    }
}

/** 解包结果：要么得到一个可直接派发的调用，要么得到一条给模型的拒绝原因 */
export type BridgeResolution =
    | { ok: true; toolName: string; params: Record<string, unknown> }
    | { ok: false; error: string };

/**
 * 把 tool_call 的信封解成对目标工具的直接调用。运行时在查找工具**之前**调用它，
 * 解包后继续走与普通动作完全相同的那段流程。
 *
 * 名字解析大小写不敏感（照 qwen-code），因为模型偶尔会改大小写。
 */
export function resolveDeferredToolCall(
    params: Record<string, unknown>,
    tools: ReadonlyMap<string, Tool<ToolParams>>,
): BridgeResolution {
    const rawName = params['name'];
    if (typeof rawName !== 'string' || rawName.trim() === '') {
        return { ok: false, error: 'tool_call 的 name 必须是非空字符串' };
    }
    const name = rawName.trim();

    if (name === TOOL_CALL || name === TOOL_SEARCH) {
        // 禁止套娃：否则可以用 tool_call 无限包一层 tool_call。
        return {
            ok: false,
            error: `${name} 不能作为 tool_call 的目标：它是声明里的工具，请直接调用`,
        };
    }

    const target = tools.get(name) ?? tools.get(name.toLowerCase());
    if (!target) {
        return { ok: false, error: `tool_call 指向了未知的工具: ${name}` };
    }

    const args = params['arguments'];
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
        return { ok: false, error: 'tool_call 的 arguments 必须是对象' };
    }

    return {
        ok: true,
        toolName: target.name,
        params: args as Record<string, unknown>,
    };
}
