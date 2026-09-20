
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve, normalize } from 'path';
import type { Tool, ToolParams, ToolContext, ToolResult, ValidationResult } from '../types/Tool.js';

interface CreateFileParams extends ToolParams {
    path: string;              // 相对于工作区的文件路径
    content: string;           // 文件内容
    overwrite?: boolean;       // 是否覆盖已有文件，默认 false
}

export class CreateFileTool implements Tool<CreateFileParams> {
    name = 'create_file';
    description = '在工作区中创建新文件，支持自动创建父目录';

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
                path: { type: 'string', description: '文件路径（相对于工作区）' },
                content: { type: 'string', description: '文件内容' },
                overwrite: { type: 'boolean', description: '是否覆盖已有文件，默认 false' },
            },
            required: ['path', 'content'],
        };
    }

    validate(params: unknown): ValidationResult {
        if (!params || typeof params !== 'object') {
            return { valid: false, errors: ['参数必须是对象'], sanitized: {} as CreateFileParams };
        }

        const p = params as Record<string, unknown>;
        const errors: string[] = [];

        if (!p.path || typeof p.path !== 'string' || p.path.trim() === '') {
            errors.push('path 是必填字段，且必须是非空字符串');
        }

        if (p.content === undefined || typeof p.content !== 'string') {
            errors.push('content 是必填字段，且必须是字符串');
        }

        // 路径安全检查：防止路径穿越
        if (typeof p.path === 'string') {
            const normalized = normalize(p.path);
            if (normalized.startsWith('..') || normalized.includes('..')) {
                errors.push('路径不能包含上级目录引用 (..)');
            }
            if (normalized.startsWith('/') || normalized.match(/^[A-Za-z]:\\/)) {
                errors.push('路径必须是相对路径，不能是绝对路径');
            }
        }

        if (errors.length > 0) {
            return { valid: false, errors, sanitized: {} as CreateFileParams };
        }

        return {
            valid: true,
            errors: [],
            sanitized: {
                path: (p.path as string).trim().replace(/\\/g, '/'),
                content: p.content as string,
                overwrite: p.overwrite === true,
            },
        };
    }



    async execute(params: CreateFileParams, ctx: ToolContext): Promise<ToolResult> {
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


            // 检查文件是否已存在
            try {
                const fs = await import('fs');
                if (fs.existsSync(targetPath)) {
                    if (!params.overwrite) {
                        return {
                            success: false,
                            data: null,
                            error: `文件已存在: ${params.path}（如需覆盖请设置 overwrite: true）`,
                        };
                    }
                }
            } catch {
                // 不存在，继续
            }

            // 自动创建父目录
            mkdirSync(dirname(targetPath), { recursive: true });

            // 写入文件
            writeFileSync(targetPath, params.content, 'utf-8');

            return {
                success: true,
                data: {
                    path: params.path,
                    size: Buffer.byteLength(params.content, 'utf-8'),
                    created: true,
                },
            };
        } catch (err) {
            return {
                success: false,
                data: null,
                error: `创建文件失败: ${(err as Error).message}`,
            };
        }
    }
}