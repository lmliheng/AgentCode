// src/tools/list_files.ts

import { readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import type{ Tool, ToolParams, ToolContext, ToolResult, ValidationResult } from '../types/Tool.js';

interface ListFilesParams extends ToolParams {
    path?: string;             // 起始路径，默认工作区根目录
    recursive?: boolean;       // 是否递归，默认 false
    depth?: number;            // 递归深度，默认无限制（仅 recursive=true 时有效）
    pattern?: string;          // glob 模式过滤（简化版：只支持前缀匹配）
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
    description = '列出工作区中的文件和目录，支持递归遍历和过滤';
    
    permissions = {
        readsFiles: true,
        writesFiles: false,
        runsShell: false,
        requiresApproval: false,
    };

    getSchema() {
        return {
            type: 'object',
            properties: {
                path: { type: 'string', description: '起始路径，默认为工作区根目录' },
                recursive: { type: 'boolean', description: '是否递归子目录' },
                depth: { type: 'number', description: '递归深度' },
                pattern: { type: 'string', description: '文件名过滤（前缀匹配）' },
                includeDirs: { type: 'boolean', description: '是否包含目录' },
                includeFiles: { type: 'boolean', description: '是否包含文件' },
                maxResults: { type: 'number', description: '最大结果数' },
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
            const startPath = params.path
                ? resolve(join(ctx.workspaceRoot, params.path))
                : resolve(ctx.workspaceRoot);

            // 安全检查
            const allowed = ctx.allowedPaths.some(p => startPath.startsWith(resolve(p)));
            if (!allowed) {
                return {
                    success: false,
                    data: null,
                    error: `路径 ${params.path || '.'} 不在允许的工作区内`,
                };
            }

            const entries: FileEntry[] = [];
            const maxDepth = params.depth ?? Infinity;

            this.walkDirectory(startPath, ctx.workspaceRoot, 0, maxDepth, params, entries);

            return {
                success: true,
                data: {
                    path: params.path || '.',
                    entries,
                    total: entries.length,
                    truncated: entries.length >= (params.maxResults ?? 200),
                },
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

                // pattern 过滤（前缀匹配）
                if (params.pattern && !item.startsWith(params.pattern)) {
                    continue;
                }

                if (stats.isDirectory()) {
                    if (params.includeDirs !== false) {
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
                    if (params.includeFiles !== false) {
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