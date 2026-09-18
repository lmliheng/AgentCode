// src/tools/delete_file.ts

import { unlinkSync, rmdirSync, readdirSync, existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import type { Tool, ToolParams, ToolContext, ToolResult, ValidationResult } from '../types/Tool.js';

interface DeleteFileParams extends ToolParams {
    path: string;              // 要删除的文件或空目录路径
    force?: boolean;           // 是否强制删除（跳过确认），默认 false
    recursive?: boolean;       // 是否递归删除目录，默认 false
}

export class DeleteFileTool implements Tool<DeleteFileParams> {
    name = 'delete_file';
    description = '删除文件或空目录，支持递归删除和强制模式';

    permissions = {
        readsFiles: false,
        writesFiles: true,
        runsShell: false,
        requiresApproval: true,
    };

    getSchema() {
        return {
            type: 'object',
            properties: {
                path: { type: 'string', description: '要删除的文件或目录路径' },
                force: { type: 'boolean', description: '是否强制删除（跳过确认）' },
                recursive: { type: 'boolean', description: '是否递归删除目录' },
            },
            required: ['path'],
        };
    }

    validate(params: unknown): ValidationResult {
        if (!params || typeof params !== 'object') {
            return { valid: false, errors: ['参数必须是对象'], sanitized: {} as DeleteFileParams };
        }

        const p = params as Record<string, unknown>;
        const errors: string[] = [];

        if (!p.path || typeof p.path !== 'string' || p.path.trim() === '') {
            errors.push('path 是必填字段，且必须是非空字符串');
        }

        // 路径安全检查
        if (typeof p.path === 'string') {
            const normalized = resolve(p.path);
            if (normalized === '/' || normalized.match(/^[A-Za-z]:\\$/)) {
                errors.push('不能删除根目录');
            }
        }

        if (errors.length > 0) {
            return { valid: false, errors, sanitized: {} as DeleteFileParams };
        }

        return {
            valid: true,
            errors: [],
            sanitized: {
                path: (p.path as string).trim().replace(/\\/g, '/'),
                force: p.force === true,
                recursive: p.recursive === true,
            },
        };
    }

    async execute(params: DeleteFileParams, ctx: ToolContext): Promise<ToolResult> {
        try {
            const targetPath = resolve(join(ctx.workspaceRoot, params.path));

            // 安全检查：必须在允许的路径内
            const allowed = ctx.allowedPaths.some(p => targetPath.startsWith(resolve(p)));
            if (!allowed) {
                return {
                    success: false,
                    data: null,
                    error: `路径 ${params.path} 不在允许的工作区内`,
                };
            }

            // 检查是否存在
            if (!existsSync(targetPath)) {
                return {
                    success: false,
                    data: null,
                    error: `路径不存在: ${params.path}`,
                };
            }

            const stats = statSync(targetPath);

            // 请求确认
            if (!params.force) {
                const approval = await ctx.requestApproval({
                    id: `${ctx.runId}-del-${Date.now()}`,
                    runId: ctx.runId,
                    createdAt: Date.now(),
                    source: {
                        thought: `需要删除: ${params.path}`,
                        decision: {
                            type: 'Action',
                            tool: 'delete_file',
                            params: params as unknown as Record<string, unknown>,
                        },
                        contextSnapshot: {
                            currentPlan: '删除文件',
                            recentHistory: '',
                            currentStep: 'delete_file',
                        },
                    },
                    preview: {
                        tool: 'delete_file',
                        summary: `删除 ${stats.isDirectory() ? '目录' : '文件'}: ${params.path}`,
                        affectedFiles: [{
                            path: params.path,
                            changeType: 'delete',
                        }],
                        riskLevel: stats.isDirectory() ? 'high' : 'medium',
                    },
                    status: 'pending',
                    expiresAt: Date.now() + 5 * 60 * 1000,
                });

                if (approval !== 'approve') {
                    return {
                        success: false,
                        data: null,
                        error: '用户取消了删除操作',
                    };
                }
            }

            // 执行删除
            if (stats.isDirectory()) {
                if (params.recursive) {
                    this.removeDirectoryRecursive(targetPath);
                } else {
                    rmdirSync(targetPath); // 只能删空目录
                }
            } else {
                unlinkSync(targetPath);
            }

            return {
                success: true,
                data: {
                    path: params.path,
                    deleted: true,
                    type: stats.isDirectory() ? 'directory' : 'file',
                },
            };
        } catch (err) {
            return {
                success: false,
                data: null,
                error: `删除失败: ${(err as Error).message}`,
            };
        }
    }

    private removeDirectoryRecursive(dirPath: string): void {
        const items = readdirSync(dirPath);
        for (const item of items) {
            const fullPath = join(dirPath, item);
            const stats = statSync(fullPath);
            if (stats.isDirectory()) {
                this.removeDirectoryRecursive(fullPath);
            } else {
                unlinkSync(fullPath);
            }
        }
        rmdirSync(dirPath);
    }
}