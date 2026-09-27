// src/glob.ts

import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import type { Tool, ToolParams, ToolContext, ToolResult, ValidationResult } from '@lmliheng/acode-core';
import { isIgnoredEntry, resolveInWorkspace } from './fs-guard.js';
import { compileGlob, hasWildcard } from './glob-match.js';

/** 默认最多返回多少条：够看清结构，又不至于把上下文塞满 */
const DEFAULT_MAX_RESULTS = 200;
/** 上限硬顶：调用方要更多也只是把它截断得更晚一些，不能没有边界 */
const HARD_MAX_RESULTS = 2000;

interface GlobParams extends ToolParams {
    pattern: string;          // 通配符模式，如 "src/**/*.ts"
    path?: string;            // 只在这个子目录里找，默认整个工作区
    maxResults?: number;      // 最大返回条数，默认 200
    includeIgnored?: boolean; // 是否连 node_modules 等都搜，默认 false
}

export class GlobTool implements Tool<GlobParams> {
    name = 'glob';
    description = `按通配符查找文件路径（找文件用这个，不要拿 list_files 的 pattern 凑）。

- 支持 *（不跨 /）、?（单个字符）、**（跨目录）、{a,b}（多选一）：如 "src/**/*.{ts,tsx}"。
- 模式里不写 / 时按「任意目录下的这个文件名」理解："*.md" 等同于 "**/*.md"。
- 只返回文件，不返回目录；默认跳过 node_modules/.git/dist/.next/build/coverage。
- path 只用来缩小搜索范围；匹配与返回的路径始终相对工作区根，可直接给其他工具用。
- 结果按路径排序，默认最多 ${DEFAULT_MAX_RESULTS} 条；total 是命中总数，truncated 表示被截断。
- 要看目录结构用 read_directory，要按内容找用 search_code。`;

    permissions = {
        readsFiles: true,
        writesFiles: false,
        runsShell: false,
        requiresApproval: false,
    };

    /** 与 list_files 同档：路径列表很容易失控，maxResults 只限条数不限体积 */
    outputBudget = { maxChars: 12000, maxLines: 400 };

    getSchema() {
        return {
            type: 'object',
            properties: {
                pattern: {
                    type: 'string',
                    description: '通配符模式，如 "src/**/*.ts"、"*.md"、"**/test_*.ts"',
                },
                path: { type: 'string', description: '只在此子目录内查找（工作区内相对路径，默认整个工作区）' },
                maxResults: { type: 'number', description: `最大返回条数（默认 ${DEFAULT_MAX_RESULTS}）`, minimum: 1 },
                includeIgnored: { type: 'boolean', description: '是否连 node_modules/.git/dist 等一起搜（默认 false）' },
            },
            required: ['pattern'],
        };
    }

    validate(params: unknown): ValidationResult {
        if (!params || typeof params !== 'object') {
            return { valid: false, errors: ['参数必须是对象'], sanitized: {} as GlobParams };
        }

        const p = params as Record<string, unknown>;
        const errors: string[] = [];

        if (typeof p.pattern !== 'string' || p.pattern.trim() === '') {
            errors.push('pattern 必须是非空字符串');
        }
        if (p.maxResults !== undefined && (typeof p.maxResults !== 'number' || p.maxResults < 1)) {
            errors.push('maxResults 必须是大于 0 的数字');
        }

        if (errors.length > 0) {
            return { valid: false, errors, sanitized: {} as GlobParams };
        }

        return {
            valid: true,
            errors: [],
            sanitized: {
                pattern: (p.pattern as string).trim(),
                path: p.path as string | undefined,
                maxResults: Math.min(p.maxResults as number | undefined ?? DEFAULT_MAX_RESULTS, HARD_MAX_RESULTS),
                includeIgnored: p.includeIgnored === true,
            },
        };
    }

    async execute(params: GlobParams, ctx: ToolContext): Promise<ToolResult> {
        try {
            // 与其余文件工具同一套边界判定：path 缺省时即工作区根
            const guard = resolveInWorkspace(ctx.workspaceRoot, params.path ?? '.', ctx.allowedPaths);
            if (!guard.allowed) {
                return {
                    success: false,
                    data: null,
                    error: `路径 ${params.path || '.'} 不在允许的工作区内`,
                };
            }

            const pattern = params.pattern.trim();
            const matcher = compileGlob(pattern);
            const limit = params.maxResults ?? DEFAULT_MAX_RESULTS;

            const found: string[] = [];
            this.walk(guard.resolved, ctx.workspaceRoot, params.includeIgnored === true, matcher, found);

            found.sort();
            const matches = found.slice(0, limit);

            const scope = params.path ?? '.';
            const hint = hasWildcard(pattern) ? '' : '（模式里没有通配符，只按文件名精确匹配）';

            return {
                success: true,
                data: {
                    pattern,
                    path: scope,
                    matches,
                    total: found.length,
                    truncated: found.length > matches.length,
                },
                display: `${scope} / ${pattern} 命中 ${found.length} 个文件`
                    + (found.length > matches.length ? `（只返回前 ${matches.length} 个）` : '')
                    + hint,
            };
        } catch (err) {
            return {
                success: false,
                data: null,
                error: `查找文件失败: ${(err as Error).message}`,
            };
        }
    }

    /**
     * 递归收集文件路径。
     *
     * 相对路径按**工作区根**算（不是按起始目录）：调用方不必知道这次搜索是从
     * 哪个子目录开始的，拿到的路径直接能喂给别的工具。
     */
    private walk(
        dirPath: string,
        rootPath: string,
        includeIgnored: boolean,
        matcher: (path: string) => boolean,
        found: string[],
    ): void {
        let items: string[];
        try {
            items = readdirSync(dirPath);
        } catch {
            return; // 读不了的目录直接跳过，不让它把整次搜索带走
        }

        for (const item of items) {
            const fullPath = join(dirPath, item);

            let stats: ReturnType<typeof statSync>;
            try {
                stats = statSync(fullPath);
            } catch {
                continue; // 悬空符号链接等
            }

            if (stats.isDirectory()) {
                if (!includeIgnored && isIgnoredEntry(item)) continue;
                this.walk(fullPath, rootPath, includeIgnored, matcher, found);
                continue;
            }

            if (!stats.isFile()) continue;

            const relPath = relative(rootPath, fullPath).split('\\').join('/');
            if (matcher(relPath)) found.push(relPath);
        }
    }
}
