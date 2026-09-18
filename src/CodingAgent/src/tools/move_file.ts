// src/tools/move_file.ts

import { renameSync, existsSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import type { Tool, ToolParams, ToolContext, ToolResult, ValidationResult } from '../types/Tool.js';

interface MoveFileParams extends ToolParams {
    source: string;            // 源路径
    destination: string;       // 目标路径
    overwrite?: boolean;       // 是否覆盖已存在的目标，默认 false
}

export class MoveFileTool implements Tool<MoveFileParams> {
    name = 'move_file';
    description = '移动或重命名文件/目录';

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
                source: { type: 'string', description: '源文件/目录路径' },
                destination: { type: 'string', description: '目标路径' },
                overwrite: { type: 'boolean', description: '是否覆盖已存在的目标' },
            },
            required: ['source', 'destination'],
        };
    }

    validate(params: unknown): ValidationResult {
        if (!params || typeof params !== 'object') {
            return { valid: false, errors: ['参数必须是对象'], sanitized: {} as MoveFileParams };
        }

        const p = params as Record<string, unknown>;
        const errors: string[] = [];

        if (!p.source || typeof p.source !== 'string' || p.source.trim() === '') {
            errors.push('source 是必填字段，且必须是非空字符串');
        }

        if (!p.destination || typeof p.destination !== 'string' || p.destination.trim() === '') {
            errors.push('destination 是必填字段，且必须是非空字符串');
        }

        if (typeof p.source === 'string' && typeof p.destination === 'string') {
            if (p.source === p.destination) {
                errors.push('源路径和目标路径不能相同');
            }
        }

        if (errors.length > 0) {
            return { valid: false, errors, sanitized: {} as MoveFileParams };
        }

        return {
            valid: true,
            errors: [],
            sanitized: {
                source: (p.source as string).trim().replace(/\\/g, '/'),
                destination: (p.destination as string).trim().replace(/\\/g, '/'),
                overwrite: p.overwrite === true,
            },
        };
    }

    async execute(params: MoveFileParams, ctx: ToolContext): Promise<ToolResult> {
        try {
            const sourcePath = resolve(join(ctx.workspaceRoot, params.source));
            const destPath = resolve(join(ctx.workspaceRoot, params.destination));

            // 安全检查：源和目标都必须在允许的路径内
            const sourceAllowed = ctx.allowedPaths.some(p => sourcePath.startsWith(resolve(p)));
            const destAllowed = ctx.allowedPaths.some(p => destPath.startsWith(resolve(p)));

            if (!sourceAllowed) {
                return {
                    success: false,
                    data: null,
                    error: `源路径 ${params.source} 不在允许的工作区内`,
                };
            }
            if (!destAllowed) {
                return {
                    success: false,
                    data: null,
                    error: `目标路径 ${params.destination} 不在允许的工作区内`,
                };
            }

            // 检查源是否存在
            if (!existsSync(sourcePath)) {
                return {
                    success: false,
                    data: null,
                    error: `源路径不存在: ${params.source}`,
                };
            }

            // 检查目标是否已存在
            if (existsSync(destPath) && !params.overwrite) {
                return {
                    success: false,
                    data: null,
                    error: `目标路径已存在: ${params.destination}（如需覆盖请设置 overwrite: true）`,
                };
            }

            // 请求确认
            const approval = await ctx.requestApproval({
                id: `${ctx.runId}-mv-${Date.now()}`,
                runId: ctx.runId,
                createdAt: Date.now(),
                source: {
                    thought: `需要移动: ${params.source} -> ${params.destination}`,
                    decision: {
                        type: 'Action',
                        tool: 'move_file',
                        params: params as unknown as Record<string, unknown>,
                    },
                    contextSnapshot: {
                        currentPlan: '移动文件',
                        recentHistory: '',
                        currentStep: 'move_file',
                    },
                },
                preview: {
                    tool: 'move_file',
                    summary: `移动 ${params.source} 到 ${params.destination}`,
                    affectedFiles: [
                        { path: params.source, changeType: 'delete' },
                        { path: params.destination, changeType: 'create' },
                    ],
                    riskLevel: 'medium',
                },
                status: 'pending',
                expiresAt: Date.now() + 5 * 60 * 1000,
            });

            if (approval !== 'approve') {
                return {
                    success: false,
                    data: null,
                    error: '用户取消了移动操作',
                };
            }

            // 自动创建目标父目录
            mkdirSync(dirname(destPath), { recursive: true });

            // 执行移动
            renameSync(sourcePath, destPath);

            return {
                success: true,
                data: {
                    source: params.source,
                    destination: params.destination,
                    moved: true,
                },
            };
        } catch (err) {
            return {
                success: false,
                data: null,
                error: `移动失败: ${(err as Error).message}`,
            };
        }
    }
}