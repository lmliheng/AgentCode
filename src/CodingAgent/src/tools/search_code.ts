// src/tools/search_code.ts

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import type { Tool, ToolParams, ToolContext, ToolResult, ValidationResult } from '../types/Tool.js';

interface SearchCodeParams extends ToolParams {
    pattern: string;
    path?: string;           // 搜索路径，默认工作区根目录
    include?: string[];      // 包含的文件扩展名，如 ['.ts', '.js']
    exclude?: string[];      // 排除的目录或文件，如 ['node_modules', 'dist']
    maxResults?: number;     // 最大结果数，默认 50
    caseSensitive?: boolean; // 是否区分大小写，默认 false
    contextLines?: number;   // 匹配行上下文的行数，默认 0
}

interface MatchResult {
    file: string;
    line: number;
    column: number;
    content: string;
    context?: {
        before: string[];
        after: string[];
    };
}

export class SearchCodeTool implements Tool<SearchCodeParams> {
    name = 'search_code';
    description = `按行搜索工作区内的文件内容，返回匹配的文件、行号与整行内容。

- 只想读某个已知文件的内容请用 read_file，不要用本工具。
- 每行最多返回一条匹配；truncated 表示结果是否被截断。`;

    permissions = {
        readsFiles: true,
        writesFiles: false,
        runsShell: false,
        requiresApproval: false,
    };
    /** 命中的行会带上上下文行，按体积（字符 + 行数）而非仅条数约束 */
    outputBudget = { maxChars: 12000, maxLines: 400 };

    getSchema() {
        return {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: '正则表达式，不是纯文本；元字符需转义，非法正则会直接失败' },
                path: { type: 'string', description: '搜索起始路径（工作区内相对路径，默认为工作区根目录）' },
                include: { type: 'array', items: { type: 'string' }, description: '文件扩展名白名单，须小写带点，如 [".ts", ".js"]（默认不过滤）' },
                exclude: { type: 'array', items: { type: 'string' }, description: '按条目名排除的目录或文件，不是路径前缀，如 ["node_modules"]（默认排除 node_modules/.git/dist）' },
                maxResults: { type: 'number', description: '最大返回条数（默认 50）', minimum: 1 },
                caseSensitive: { type: 'boolean', description: '是否区分大小写（默认 false）' },
                contextLines: { type: 'number', description: '每条匹配附带的前后文行数（默认 0）', minimum: 0 },
            },
            required: ['pattern'],
        };
    }

    validate(params: unknown): ValidationResult {
        if (!params || typeof params !== 'object') {
            return { valid: false, errors: ['参数必须是对象'], sanitized: {} as SearchCodeParams };
        }

        const p = params as Record<string, unknown>;
        const errors: string[] = [];

        if (!p.pattern || typeof p.pattern !== 'string' || p.pattern.trim() === '') {
            errors.push('pattern 是必填字段，且必须是非空字符串');
        }

        if (p.path !== undefined && (typeof p.path !== 'string' || p.path.trim() === '')) {
            errors.push('path 必须是有效的字符串');
        }

        if (p.include !== undefined && !Array.isArray(p.include)) {
            errors.push('include 必须是数组');
        }

        if (p.exclude !== undefined && !Array.isArray(p.exclude)) {
            errors.push('exclude 必须是数组');
        }

        if (p.maxResults !== undefined && (typeof p.maxResults !== 'number' || p.maxResults < 1)) {
            errors.push('maxResults 必须是大于 0 的数字');
        }

        if (errors.length > 0) {
            return { valid: false, errors, sanitized: {} as SearchCodeParams };
        }

        return {
            valid: true,
            errors: [],
            sanitized: {
                pattern: (p.pattern as string).trim(),
                path: p.path as string | undefined,
                include: p.include as string[] | undefined,
                exclude: p.exclude as string[] | undefined ?? ['node_modules', '.git', 'dist'],
                maxResults: p.maxResults ?? 50,
                caseSensitive: p.caseSensitive === true,
                contextLines: p.contextLines ?? 0,
            },
        };
    }

    async execute(params: SearchCodeParams, ctx: ToolContext): Promise<ToolResult> {
        try {
            const searchPath = params.path
                ? join(ctx.workspaceRoot, params.path)
                : ctx.workspaceRoot;

            // 安全检查
            const resolved = join(searchPath);
            const allowed = ctx.allowedPaths.some(p => resolved.startsWith(p));
            if (!allowed) {
                return {
                    success: false,
                    data: null,
                    error: `路径 ${params.path || '.'} 不在允许的工作区内`,
                };
            }

            const regex = new RegExp(params.pattern, params.caseSensitive ? 'g' : 'gi');
            const results: MatchResult[] = [];
            const excludeDirs = new Set(params.exclude || ['node_modules', '.git', 'dist']);
            const includeExts = params.include;

            this.searchInDirectory(
                searchPath,
                '',
                regex,
                excludeDirs,
                includeExts,
                params.maxResults ?? 50,
                params.contextLines ?? 0,
                results
            );

            return {
                success: true,
                data: {
                    pattern: params.pattern,
                    matches: results,
                    total: results.length,
                    truncated: results.length >= (params.maxResults ?? 50),
                },
            };
        } catch (err) {
            return {
                success: false,
                data: null,
                error: `搜索失败: ${(err as Error).message}`,
            };
        }
    }

    private searchInDirectory(
        basePath: string,
        relativePath: string,
        regex: RegExp,
        excludeDirs: Set<string>,
        includeExts: string[] | undefined,
        maxResults: number,
        contextLines: number,
        results: MatchResult[]
    ): void {
        if (results.length >= maxResults) return;

        const fullPath = join(basePath, relativePath);

        try {
            const items = readdirSync(fullPath);

            for (const item of items) {
                if (results.length >= maxResults) break;
                if (excludeDirs.has(item)) continue;

                const itemPath = join(fullPath, item);
                const stats = statSync(itemPath);

                if (stats.isDirectory()) {
                    this.searchInDirectory(
                        basePath,
                        join(relativePath, item),
                        regex,
                        excludeDirs,
                        includeExts,
                        maxResults,
                        contextLines,
                        results
                    );
                } else if (stats.isFile()) {
                    // 检查文件扩展名
                    if (includeExts && includeExts.length > 0) {
                        const ext = extname(item).toLowerCase();
                        if (!includeExts.includes(ext)) continue;
                    }

                    // 跳过二进制文件
                    const binaryExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.eot', '.ttf']);
                    if (binaryExts.has(extname(item).toLowerCase())) continue;

                    try {
                        const content = readFileSync(itemPath, 'utf-8');
                        const lines = content.split('\n');

                        for (let i = 0; i < lines.length; i++) {
                            if (results.length >= maxResults) break;

                            regex.lastIndex = 0; // 重置正则
                            const match = regex.exec(lines[i]!);
                            if (match) {
                                const result: MatchResult = {
                                    file: join(relativePath, item),
                                    line: i + 1,
                                    column: match.index + 1,
                                    content: lines[i]!.trim(),
                                };

                                if (contextLines > 0) {
                                    const before: string[] = [];
                                    const after: string[] = [];

                                    for (let j = Math.max(0, i - contextLines); j < i; j++) {
                                        before.push(lines[j]!);
                                    }
                                    for (let j = i + 1; j <= Math.min(lines.length - 1, i + contextLines); j++) {
                                        after.push(lines[j]!);
                                    }

                                    result.context = { before, after };
                                }

                                results.push(result);
                            }
                        }
                    } catch {
                        // 跳过无法读取的文件
                    }
                }
            }
        } catch {
            // 跳过无法访问的目录
        }
    }
}