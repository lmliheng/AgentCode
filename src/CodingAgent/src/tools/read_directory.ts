// src/tools/read_directory.ts

import { readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import type{ Tool, ToolParams, ToolContext, ToolResult, ValidationResult } from '../types/Tool.js';

interface ReadDirectoryParams extends ToolParams {
    path?: string;             // 目录路径，默认工作区根目录
    maxDepth?: number;         // 最大深度，默认 1（仅当前层）
    showHidden?: boolean;      // 是否显示隐藏文件，默认 false
    maxItems?: number;         // 最大条目数，默认 500
}

interface DirEntry {
    name: string;
    path: string;
    type: 'file' | 'directory';
    size?: number;
    children?: DirEntry[];     // 仅目录有此字段
}

export class ReadDirectoryTool implements Tool<ReadDirectoryParams> {
    name = 'read_directory';
    description = '读取目录结构，返回树形层级信息';
    
    permissions = {
        readsFiles: true,
        writesFiles: false,
        runsShell: false,
        requiresApproval: false,
    };
    /**
     * maxItems 只限条目数，且返回的是嵌套树（每项还带 path/size），
     * 体积仍然不定 —— 这里补上字符与行数两个维度。
     */
    outputBudget = { maxChars: 12000, maxLines: 400 };

    getSchema() {
        return {
            type: 'object',
            properties: {
                path: { type: 'string', description: '目录路径，默认为工作区根目录' },
                maxDepth: { type: 'number', description: '最大深度，默认 1' },
                showHidden: { type: 'boolean', description: '是否显示隐藏文件' },
                maxItems: { type: 'number', description: '最大条目数' },
            },
        };
    }

    validate(params: unknown): ValidationResult {
        if (!params || typeof params !== 'object') {
            return { valid: false, errors: ['参数必须是对象'], sanitized: {} as ReadDirectoryParams };
        }

        const p = params as Record<string, unknown>;
        const errors: string[] = [];

        if (p.maxDepth !== undefined && (typeof p.maxDepth !== 'number' || p.maxDepth < 1)) {
            errors.push('maxDepth 必须是大于等于 1 的数字');
        }

        if (p.maxItems !== undefined && (typeof p.maxItems !== 'number' || p.maxItems < 1)) {
            errors.push('maxItems 必须是大于 0 的数字');
        }

        if (errors.length > 0) {
            return { valid: false, errors, sanitized: {} as ReadDirectoryParams };
        }

        return {
            valid: true,
            errors: [],
            sanitized: {
                path: p.path as string | undefined,
                maxDepth: p.maxDepth ?? 1,
                showHidden: p.showHidden === true,
                maxItems: p.maxItems ?? 500,
            },
        };
    }

    async execute(params: ReadDirectoryParams, ctx: ToolContext): Promise<ToolResult> {
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

            let itemCount = 0;
            const root = this.readDirRecursive(
                startPath,
                ctx.workspaceRoot,
                0,
                params.maxDepth ?? 1,
                params.showHidden ?? false,
                params.maxItems ?? 500,
                { count: 0 }
            );

            if (!root) {
                return {
                    success: false,
                    data: null,
                    error: '无法读取目录',
                };
            }

            return {
                success: true,
                data: {
                    path: params.path || '.',
                    structure: root,
                    total: root.children?.length ?? 0,
                },
            };
        } catch (err) {
            return {
                success: false,
                data: null,
                error: `读取目录失败: ${(err as Error).message}`,
            };
        }
    }

    private readDirRecursive(
        dirPath: string,
        rootPath: string,
        currentDepth: number,
        maxDepth: number,
        showHidden: boolean,
        maxItems: number,
        state: { count: number }
    ): DirEntry | null {
        if (state.count >= maxItems) return null;

        try {
            const items = readdirSync(dirPath);
            const entry: DirEntry = {
                name: relative(rootPath, dirPath) || '.',
                path: relative(rootPath, dirPath).replace(/\\/g, '/') || '.',
                type: 'directory',
                children: [],
            };

            for (const item of items) {
                if (state.count >= maxItems) break;

                // 隐藏文件过滤
                if (!showHidden && item.startsWith('.')) continue;

                const fullPath = join(dirPath, item);
                const relPath = relative(rootPath, fullPath).replace(/\\/g, '/');

                try {
                    const stats = statSync(fullPath);

                    if (stats.isDirectory()) {
                        const childEntry: DirEntry = {
                            name: item,
                            path: relPath,
                            type: 'directory',
                        };

                        if (currentDepth < maxDepth) {
                            const subChildren = this.readDirRecursive(
                                fullPath,
                                rootPath,
                                currentDepth + 1,
                                maxDepth,
                                showHidden,
                                maxItems,
                                state
                            );
                            if (subChildren) {
                                childEntry.children = subChildren.children!;
                            }
                        }

                        entry.children!.push(childEntry);
                        state.count++;
                    } else if (stats.isFile()) {
                        entry.children!.push({
                            name: item,
                            path: relPath,
                            type: 'file',
                            size: stats.size,
                        });
                        state.count++;
                    }
                } catch {
                    continue;
                }
            }

            return entry;
        } catch {
            return null;
        }
    }
}