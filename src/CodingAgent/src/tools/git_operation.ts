// src/tools/git_operation.ts

import { execSync, type ExecSyncOptions } from 'child_process';
import { join, resolve } from 'path';
import type { Tool, ToolParams, ToolContext, ToolResult, ValidationResult } from '../types/Tool.js';

type GitOperation = 'status' | 'diff' | 'log' | 'commit' | 'branch' | 'checkout' | 'add';

interface GitOperationParams extends ToolParams {
    operation: GitOperation;
    paths?: string[];          // 操作路径（add/commit 时使用）
    message?: string;          // commit message
    branch?: string;           // 分支名（checkout/branch 时使用）
    limit?: number;            // log 条数限制，默认 10
}

export class GitOperationTool implements Tool<GitOperationParams> {
    name = 'git_operation';
    description = '执行 Git 操作：status/diff/log/commit/branch/checkout/add';

    permissions = {
        readsFiles: true,
        writesFiles: true,
        runsShell: true,
        requiresApproval: true,
    };

    private readonly readOnlyOps: Set<GitOperation> = new Set(['status', 'diff', 'log', 'branch']);
    private readonly writeOps: Set<GitOperation> = new Set(['commit', 'checkout', 'add']);

    getSchema() {
        return {
            type: 'object',
            properties: {
                operation: {
                    type: 'string',
                    enum: ['status', 'diff', 'log', 'commit', 'branch', 'checkout', 'add'],
                    description: 'Git 操作类型'
                },
                paths: { type: 'array', items: { type: 'string' }, description: '操作路径' },
                message: { type: 'string', description: 'commit 消息' },
                branch: { type: 'string', description: '分支名' },
                limit: { type: 'number', description: 'log 条数限制' },
            },
            required: ['operation'],
        };
    }

    validate(params: unknown): ValidationResult {
        if (!params || typeof params !== 'object') {
            return { valid: false, errors: ['参数必须是对象'], sanitized: {} as GitOperationParams };
        }

        const p = params as Record<string, unknown>;
        const errors: string[] = [];

        const validOps: GitOperation[] = ['status', 'diff', 'log', 'commit', 'branch', 'checkout', 'add'];
        if (!p.operation || !validOps.includes(p.operation as GitOperation)) {
            errors.push(`operation 必须是: ${validOps.join(', ')}`);
        }

        if (p.operation === 'commit' && (!p.message || typeof p.message !== 'string')) {
            errors.push('commit 操作需要提供 message');
        }

        if ((p.operation === 'checkout' || p.operation === 'branch') && (!p.branch || typeof p.branch !== 'string')) {
            errors.push(`${p.operation} 操作需要提供 branch`);
        }

        if (p.limit !== undefined && (typeof p.limit !== 'number' || p.limit < 1)) {
            errors.push('limit 必须是大于 0 的数字');
        }

        if (errors.length > 0) {
            return { valid: false, errors, sanitized: {} as GitOperationParams };
        }

        return {
            valid: true,
            errors: [],
            sanitized: {
                operation: p.operation as GitOperation,
                paths: p.paths as string[] | undefined,
                message: p.message as string | undefined,
                branch: p.branch as string | undefined,
                limit: p.limit ?? 10,
            },
        };
    }

    async execute(params: GitOperationParams, ctx: ToolContext): Promise<ToolResult> {
        try {
            const workDir = ctx.workspaceRoot;

            // 检查是否是 git 仓库
            try {
                execSync('git rev-parse --git-dir', { cwd: workDir, stdio: 'pipe' });
            } catch {
                return {
                    success: false,
                    data: null,
                    error: '当前工作区不是一个 Git 仓库',
                };
            }

            // 写操作需要确认
            if (this.writeOps.has(params.operation)) {
                const approval = await ctx.requestApproval({
                    id: `${ctx.runId}-git-${Date.now()}`,
                    runId: ctx.runId,
                    createdAt: Date.now(),
                    source: {
                        thought: `需要执行 Git 操作: ${params.operation}`,
                        decision: {
                            type: 'Action',
                            tool: 'git_operation',
                            params: params as unknown as Record<string, unknown>,
                        },
                        contextSnapshot: {
                            currentPlan: 'Git 操作',
                            recentHistory: '',
                            currentStep: 'git_operation',
                        },
                    },
                    preview: {
                        tool: 'git_operation',
                        summary: `Git ${params.operation}${params.message ? ': ' + params.message : ''}`,
                        affectedFiles: [],
                        riskLevel: params.operation === 'checkout' ? 'high' : 'medium',
                    },
                    status: 'pending',
                    expiresAt: Date.now() + 5 * 60 * 1000,
                });

                if (approval !== 'approve') {
                    return {
                        success: false,
                        data: null,
                        error: '用户取消了 Git 操作',
                    };
                }
            }

            // 构建命令
            let command: string;
            switch (params.operation) {
                case 'status':
                    command = 'git status --short';
                    break;
                case 'diff':
                    command = 'git diff';
                    if (params.paths) {
                        command += ' -- ' + params.paths.join(' ');
                    }
                    break;
                case 'log':
                    command = `git log --oneline -${params.limit ?? 10}`;
                    break;
                case 'add':
                    command = 'git add ' + (params.paths ? params.paths.join(' ') : '.');
                    break;
                case 'commit':
                    command = `git commit -m "${(params.message || '').replace(/"/g, '\\"')}"`;
                    break;
                case 'branch':
                    command = `git branch ${params.branch}`;
                    break;
                case 'checkout':
                    command = `git checkout ${params.branch}`;
                    break;
                default:
                    return {
                        success: false,
                        data: null,
                        error: `不支持的操作: ${params.operation}`,
                    };
            }

            const options: ExecSyncOptions = {
                cwd: workDir,
                timeout: 30000,
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024,
            };

            const stdout = execSync(command, options);

            return {
                success: true,
                data: {
                    operation: params.operation,
                    output: stdout.toString().trim(),
                },
            };
        } catch (err: any) {
            return {
                success: false,
                data: {
                    operation: params.operation,
                    output: err.stdout?.toString()?.trim() ?? '',
                },
                error: `Git 操作失败: ${err.stderr?.toString()?.trim() || err.message}`,
            };
        }
    }
}