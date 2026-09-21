// src/tools/tool_search.ts
//
// 检索延迟工具声明的桥。行为对齐 qwen-code 的 ToolSearchTool：
// **只回传 schema 文本，不改动当前的工具列表**——声明集全程恒定，
// 模型可见的工具列表与前缀缓存因此不会被一次检索打乱。

import type { Tool, ToolParams, ToolContext, ToolResult, ValidationResult } from '../types/Tool.js';
import { TOOL_CALL, TOOL_SEARCH, isBridgeTool } from './deferred.js';

export interface ToolSearchParams extends ToolParams {
    /** "select:ToolA,ToolB" 精确选取，或关键词查询 */
    query: string;
    /** 最多返回几条，默认 5 */
    max_results?: number;
}

const DEFAULT_MAX_RESULTS = 5;
const HARD_MAX_RESULTS = 20;

/** 只依赖「能列出延迟工具」这一件事，便于测试替身，也避免与 ToolRegistry 相互导入 */
export interface DeferredToolSource {
    getDeferredTools(): Tool[];
}

/** 名字命中权重高于描述命中，与 qwen-code 的打分表同序（此处为简化版） */
const SCORE_NAME_EXACT = 10;
const SCORE_NAME_SUBSTR = 5;
const SCORE_DESCRIPTION = 2;

export class ToolSearchTool implements Tool<ToolSearchParams> {
    readonly name = TOOL_SEARCH;
    readonly description = `检索延迟工具的声明，不改动当前的工具列表。

延迟工具的名字与一句话描述已列在系统提示的延迟工具清单里。本工具接收查询，在延迟工具集合里匹配，并把命中工具的声明（名称 + 描述 + 参数 schema）放进 <functions> 块返回。

返回的 <functions> 块只是信息。看清某个延迟工具的 schema 后，请用 ${TOOL_CALL} 传它的确切名称与符合该 schema 的参数来调用它。不要直接调用未声明的工具：它的声明保持隐藏，模型可见的工具列表与前缀缓存才能稳定。若 select: 返回的工具已在你的工具列表里，请直接调用它——${TOOL_CALL} 只接受隐藏的延迟工具。

查询形式：
- "select:ToolA,ToolB" —— 按名称精确取这些工具
- "关键词短语" —— 关键词匹配，最多返回 max_results 条`;
    readonly permissions = {
        readsFiles: false,
        writesFiles: false,
        runsShell: false,
        requiresApproval: false,
    };

    constructor(private readonly source: DeferredToolSource) { }

    validate(params: unknown): ValidationResult {
        const errors: string[] = [];
        const input = (params ?? {}) as Record<string, unknown>;

        const query = input['query'];
        if (typeof query !== 'string' || query.trim() === '') {
            errors.push('query 必须是非空字符串');
        }

        const rawMax = input['max_results'];
        let maxResults = DEFAULT_MAX_RESULTS;
        if (rawMax !== undefined) {
            if (typeof rawMax !== 'number' || !Number.isInteger(rawMax) || rawMax < 1 || rawMax > HARD_MAX_RESULTS) {
                errors.push(`max_results 必须是 1-${HARD_MAX_RESULTS} 的整数`);
            } else {
                maxResults = rawMax;
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            sanitized: {
                query: typeof query === 'string' ? query.trim() : '',
                max_results: maxResults,
            },
        };
    }

    async execute(params: ToolSearchParams, _ctx: ToolContext): Promise<ToolResult> {
        const maxResults = params.max_results ?? DEFAULT_MAX_RESULTS;
        // 只搜仍然隐藏的延迟工具，且桥工具自身不可被搜出（它们本来就是声明的）
        const candidates = this.source.getDeferredTools().filter((tool) => !isBridgeTool(tool.name));

        const selected = parseSelectQuery(params.query);
        const notFound: string[] = [];
        let matched: Tool[];

        if (selected) {
            matched = selected
                .map((name) => candidates.find((tool) => tool.name === name))
                .filter((tool): tool is Tool => tool !== undefined);
            for (const name of selected) {
                if (!candidates.some((tool) => tool.name === name)) notFound.push(name);
            }
        } else {
            const terms = params.query.toLowerCase().split(/\s+/).filter(Boolean);
            matched = candidates
                .map((tool) => ({ tool, score: scoreTool(terms, tool) }))
                .filter((entry) => entry.score > 0)
                .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
                .map((entry) => entry.tool);
        }

        const reviewed = matched.slice(0, maxResults);
        const truncated = matched.slice(maxResults).map((tool) => tool.name);

        const lines: string[] = [];
        if (reviewed.length > 0) {
            lines.push('<functions>');
            for (const tool of reviewed) {
                const declaration = JSON.stringify({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.getSchema(),
                });
                lines.push(`<function>${escapeTagBoundaries(declaration)}</function>`);
            }
            lines.push('</functions>');
        }
        if (notFound.length > 0) lines.push(`Not found: ${notFound.join(', ')}`);
        if (truncated.length > 0) {
            lines.push(`被 max_results 截断，请再发一次查询取这些：${truncated.join(', ')}`);
        }
        if (reviewed.length === 0 && notFound.length === 0) {
            lines.push('没有匹配的延迟工具。可用 select:<名称> 精确取，或换个关键词。');
        }

        return {
            success: true,
            data: {
                query: params.query,
                reviewed: reviewed.map((tool) => tool.name),
                notFound,
                truncated,
                text: lines.join('\n'),
            },
        };
    }

    getSchema(): Record<string, unknown> {
        return {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description:
                        `查找延迟工具的查询。用 "select:<工具名>" 精确选取，或用关键词搜索。`,
                    minLength: 1,
                },
                max_results: {
                    type: 'integer',
                    description: `最多返回多少条结果（默认 ${DEFAULT_MAX_RESULTS}）`,
                    minimum: 1,
                    maximum: HARD_MAX_RESULTS,
                    default: DEFAULT_MAX_RESULTS,
                },
            },
            required: ['query'],
            additionalProperties: false,
        };
    }
}

/** 解析 "select:A,B" / "select:\"A\" , 'B'" 形式；不是该形式时返回 null */
function parseSelectQuery(query: string): string[] | null {
    const match = /^select:(.+)$/is.exec(query.trim());
    if (!match?.[1]) return null;
    return match[1]
        .split(',')
        .map((name) => name.trim().replace(/^(['"])(.*)\1$/s, '$2').trim())
        .filter((name) => name !== '');
}

function scoreTool(terms: string[], tool: Tool): number {
    const name = tool.name.toLowerCase();
    const description = tool.description.toLowerCase();
    let score = 0;
    for (const term of terms) {
        if (name === term) score += SCORE_NAME_EXACT;
        else if (name.includes(term)) score += SCORE_NAME_SUBSTR;
        if (description.includes(term)) score += SCORE_DESCRIPTION;
    }
    return score;
}

/**
 * JSON 里若含 `</function>` 会把外层标签提前闭合。把 < > 转义掉，
 * 保证声明的文本不能越出它所在的标签（qwen-code 的 escapeJsonTagCharacters 同理）。
 */
function escapeTagBoundaries(json: string): string {
    return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}
