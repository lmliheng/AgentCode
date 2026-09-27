// src/tools/list_files.ts

import { readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import type{ Tool, ToolParams, ToolContext, ToolResult, ValidationResult } from '@lmliheng/acode-core';
import { resolveInWorkspace } from './fs-guard.js';
import { matchesNamePattern } from './glob-match.js';


/**
 * 
 * 忽略node_modules
 */

interface ListFilesParams extends ToolParams {
    path?: string;             // 起始路径，默认工作区根目录
    recursive?: boolean;       // 是否递归，默认 false
    depth?: number;            // 递归深度，默认无限制（仅 recursive=true 时有效）
    pattern?: string;          // 文件名过滤：不带通配符时按前缀，带通配符时按通配符
    includeDirs?: boolean;     // 是否包含目录，默认 true
    includeFiles?: boolean;    // 是否包含文件，默认 true
    maxResults?: number;       // 最大结果数，默认 200
}

interface FileEntry {
    name: string;
    path: string;              // 相对于工作区的路径
    type: 'file' | 'directory';
    size?: number;             // 文件大小（字节）
    extension?: string;        // 文件扩展名
}


export class ListFilesTool implements Tool<ListFilesParams> {
    name = 'list_files';
    description = `列出工作区中的文件和目录，返回扁平列表；要看目录层级用 read_directory（不在当前工具列表里，需先经 tool_search 查询），两者不要同时调用。

- pattern 只匹配**文件名**：写通配符时按通配符匹配（"*.ts" 匹配所有 .ts），不写通配符时按前缀匹配（"test_" 匹配 test_*.ts）。它只决定「哪些条目被返回」，不影响递归 —— 子目录照常进入。要按路径通配（如 "src/**/*.ts"）请用 glob。
- recursive 时会自动跳过 node_modules/.git/dist/.next/build/coverage。
- 返回的 total 是实际条数，truncated 表示是否被截断；返回项的 path 是相对工作区根的路径，可直接作为其他工具的 path 参数。`;
    
    permissions = {
        readsFiles: true,
        writesFiles: false,
        runsShell: false,
        requiresApproval: false,
    };
    /** maxResults 只限条数；路径与文件名字段仍会让体积失控，故补齐体积上限 */
    outputBudget = { maxChars: 12000, maxLines: 400 };

    getSchema() {
        return {
            type: 'object',
            properties: {
                path: { type: 'string', description: '起始路径（工作区内相对路径，默认为工作区根目录）' },
                recursive: { type: 'boolean', description: '是否递归子目录（默认 false）' },
                depth: { type: 'number', description: '递归层数上限，仅 recursive 为 true 时生效（默认不限）', minimum: 0 },
                pattern: { type: 'string', description: '文件名过滤：带通配符按通配符（"*.ts"），不带则按前缀（"test_"）' },
                includeDirs: { type: 'boolean', description: '是否包含目录（默认 true）' },
                includeFiles: { type: 'boolean', description: '是否包含文件（默认 true）' },
                maxResults: { type: 'number', description: '最大返回条数（默认 200）', minimum: 1 },
            },
        };
    }

    validate(params: unknown): ValidationResult {
        if (!params || typeof params !== 'object') {
            return { valid: false, errors: ['参数必须是对象'], sanitized: {} as ListFilesParams };
        }

        const p = params as Record<string, unknown>;
        const errors: string[] = [];

        if (p.depth !== undefined && (typeof p.depth !== 'number' || p.depth < 0)) {
            errors.push('depth 必须是非负整数');
        }

        if (p.maxResults !== undefined && (typeof p.maxResults !== 'number' || p.maxResults < 1)) {
            errors.push('maxResults 必须是大于 0 的数字');
        }

        if (errors.length > 0) {
            return { valid: false, errors, sanitized: {} as ListFilesParams };
        }

        return {
            valid: true,
            errors: [],
            sanitized: {
                path: p.path as string | undefined,
                recursive: p.recursive === true,
                depth: p.depth as number | undefined,
                pattern: p.pattern as string | undefined,
                includeDirs: p.includeDirs !== false,
                includeFiles: p.includeFiles !== false,
                maxResults: p.maxResults ?? 200,
            },
        };
    }

    async execute(params: ListFilesParams, ctx: ToolContext): Promise<ToolResult> {
        try {
            // 安全检查统一走 fs-guard（`params.path` 缺省时即工作区根）
            const guard = resolveInWorkspace(ctx.workspaceRoot, params.path ?? '.', ctx.allowedPaths);
            if (!guard.allowed) {
                return {
                    success: false,
                    data: null,
                    error: `路径 ${params.path || '.'} 不在允许的工作区内`,
                };
            }
            const startPath = guard.resolved;

            const entries: FileEntry[] = [];
            const maxDepth = params.depth ?? Infinity;

            this.walkDirectory(startPath, ctx.workspaceRoot, 0, maxDepth, params, entries);

            const basePath = params.path || '.';
            const truncated = entries.length >= (params.maxResults ?? 200);
            const files = entries.filter(entry => entry.type === 'file').length;
            const directories = entries.length - files;

            return {
                success: true,
                data: {
                    path: basePath,
                    entries,
                    total: entries.length,
                    truncated,
                },
                display: `${basePath} / ${files} 个文件、${directories} 个目录`
                    + (truncated ? '（已达上限，可能未列全）' : ''),
            };
        } catch (err) {
            return {
                success: false,
                data: null,
                error: `列出文件失败: ${(err as Error).message}`,
            };
        }
    }

    private walkDirectory(
        dirPath: string,
        rootPath: string,
        currentDepth: number,
        maxDepth: number,
        params: ListFilesParams,
        entries: FileEntry[]
    ): void {
        if (entries.length >= (params.maxResults ?? 200)) return;
        if (currentDepth > maxDepth) return;

        try {
            const items = readdirSync(dirPath);
            
            for (const item of items) {
                if (entries.length >= (params.maxResults ?? 200)) break;

                const fullPath = join(dirPath, item);
                const relPath = relative(rootPath, fullPath).replace(/\\/g, '/');
                let stats: ReturnType<typeof statSync>;

                try {
                    stats = statSync(fullPath);
                } catch {
                    continue; // 跳过无法访问的条目
                }

                // pattern 过滤：只过滤「要不要返回这个条目」，与递归无关。
                // 原来是先按 pattern 判一次、不匹配就 continue，于是父目录名不匹配时
                // 整棵子树都不会被进入 —— recursive + pattern 只能命中「祖辈目录名
                // 也匹配」的文件（"*.ts" 一条都搜不到就是这么来的）。
                const matched = !params.pattern || matchesNamePattern(item, params.pattern);

                if (stats.isDirectory()) {
                    if (params.includeDirs !== false && matched) {
                        entries.push({
                            name: item,
                            path: relPath,
                            type: 'directory',
                        });
                    }
                    
                    // 递归子目录（跳过 node_modules/.git/dist 等常见排除目录）
                    const skipDirs = ['node_modules', '.git', 'dist', '.next', 'build', 'coverage'];
                    if (params.recursive && !skipDirs.includes(item)) {
                        this.walkDirectory(
                            fullPath,
                            rootPath,
                            currentDepth + 1,
                            maxDepth,
                            params,
                            entries
                        );
                    }
                } else if (stats.isFile()) {
                    if (params.includeFiles !== false && matched) {
                        const ext = item.includes('.') ? item.substring(item.lastIndexOf('.')) : '';
                        entries.push({
                            name: item,
                            path: relPath,
                            type: 'file',
                            size: stats.size,
                            extension: ext,
                        });
                    }
                }
            }
        } catch {
            // 跳过无法读取的目录
        }
    }
}