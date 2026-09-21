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
    description = `执行 Git 操作。各 operation 的含义与必填参数：

- status：查看工作区改动，无其他参数。
- diff：查看尚未暂存的改动，可用 paths 限定文件。
- log：查看最近提交，limit 控制条数（默认 10）。
- add：暂存改动，paths 指定文件。不传 paths 等同于 git add .，会暂存工作区全部改动，请谨慎。
- commit：提交已暂存的内容，必须提供 message。本工具不会自动 add，先确认改动已暂存。
- branch：新建分支，必须提供 branch。这不是查看分支列表。
- checkout：切换到已有分支，必须提供 branch。

其他限制：只有上述 7 种操作（没有 push/pull/stash/merge）；工作区不是 Git 仓库时会直接失败；判断成败请看 success 与 error 字段。`;

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
                    description: '要执行的 Git 操作；各取值的含义与必填参数见工具说明'
                },
                paths: { type: 'array', items: { type: 'string' }, description: '要限定的文件路径，用于 diff 与 add；add 不传则暂存全部改动' },
                message: { type: 'string', description: '提交信息，operation 为 commit 时必填' },
                branch: { type: 'string', description: '分支名，operation 为 branch（新建）或 checkout（切换）时必填' },
                limit: { type: 'number', description: 'log 返回的提交条数（默认 10）', minimum: 1 },
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