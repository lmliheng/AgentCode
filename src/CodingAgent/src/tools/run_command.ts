
import { execSync, type ExecSyncOptions, spawn } from 'child_process';
import { join } from 'path';
import type { Tool, ToolParams, ToolContext, ToolResult, ValidationResult } from '../types/Tool.js';

interface RunCommandParams extends ToolParams {
    command: string;
    cwd?: string;              // 工作目录，默认工作区根目录
    timeout?: number;          // 超时时间（毫秒），默认 60000
    env?: Record<string, string>;  // 额外环境变量
}

export class RunCommandTool implements Tool<RunCommandParams> {
    name = 'run_command';
    description = '在工作区中执行 shell 命令，用于运行测试、编译、格式化等操作';

    permissions = {
        readsFiles: false,
        writesFiles: false,
        runsShell: true,
        requiresApproval: true,  // 执行命令需要人工确认
    };
    /**
     * 命令输出此前完全没有上限。字符上限定得比全局默认宽（因为命令输出本身较长），
     * 行数上限用于挡住「大量短行」类输出；截断会保留尾部，失败摘要不会丢。
     */
    outputBudget = { maxChars: 30000, maxLines: 500 };

    getSchema() {
        return {
            type: 'object',
            properties: {
                command: { type: 'string', description: '要执行的命令' },
                cwd: { type: 'string', description: '工作目录，默认为工作区根目录' },
                timeout: { type: 'number', description: '超时时间（毫秒），默认 60000' },
                env: { type: 'object', description: '额外的环境变量' },
            },
            required: ['command'],
        };
    }

    validate(params: unknown): ValidationResult {
        if (!params || typeof params !== 'object') {
            return { valid: false, errors: ['参数必须是对象'], sanitized: {} as RunCommandParams };
        }

        const p = params as Record<string, unknown>;
        const errors: string[] = [];

        if (!p.command || typeof p.command !== 'string' || p.command.trim() === '') {
            errors.push('command 是必填字段，且必须是非空字符串');
        }

        // 安全检查：禁止危险命令
        if (typeof p.command === 'string') {
            const dangerousCommands = ['rm -rf /', 'sudo', 'shutdown', 'reboot', 'mkfs', 'dd if='];
            const cmdLower = p.command.toLowerCase();
            for (const dangerous of dangerousCommands) {
                if (cmdLower.includes(dangerous)) {
                    errors.push(`命令包含危险操作: ${dangerous}`);
                    break;
                }
            }
        }

        if (p.timeout !== undefined && (typeof p.timeout !== 'number' || p.timeout < 1000 || p.timeout > 300000)) {
            errors.push('timeout 必须在 1000-300000 毫秒之间');
        }

        if (p.env !== undefined && (typeof p.env !== 'object' || Array.isArray(p.env))) {
            errors.push('env 必须是对象');
        }

        if (errors.length > 0) {
            return { valid: false, errors, sanitized: {} as RunCommandParams };
        }

        return {
            valid: true,
            errors: [],
            sanitized: {
                command: (p.command as string).trim(),
                cwd: p.cwd as string | undefined,
                timeout: p.timeout ?? 60000,
                env: p.env as Record<string, string> | undefined,
            },
        };
    }

    async execute(params: RunCommandParams, ctx: ToolContext): Promise<ToolResult> {
        // 先请求人工确认
        const approval = await ctx.requestApproval({
            id: `${ctx.runId}-cmd-${Date.now()}`,
            runId: ctx.runId,
            createdAt: Date.now(),
            source: {
                thought: `需要执行命令: ${params.command}`,
                decision: {
                    type: 'Action',
                    tool: 'run_command',
                    params: params as unknown as Record<string, unknown>,
                },
                contextSnapshot: {
                    currentPlan: '执行命令',
                    recentHistory: '',
                    currentStep: 'run_command',
                },
            },
            preview: {
                tool: 'run_command',
                summary: `执行命令: ${params.command}`,
                affectedFiles: [],
                riskLevel: 'medium',
            },
            status: 'pending',
            expiresAt: Date.now() + 5 * 60 * 1000,
        });

        if (approval !== 'approve') {
            return {
                success: false,
                data: null,
                error: '用户取消了命令执行',
            };
        }

        return new Promise((resolve) => {
            const workDir = params.cwd
                ? join(ctx.workspaceRoot, params.cwd)
                : ctx.workspaceRoot;

            const child = spawn(params.command, [], {
                shell: true,
                cwd: workDir,
                env: {
                    ...process.env,
                    ...params.env,
                },
            });

            // 监听取消信号
            ctx.signal?.addEventListener('abort', () => {
                child.kill();
                resolve({
                    success: false,
                    data: {
                        command: params.command,
                        exitCode: -1,
                        stdout: '',
                        stderr: '',
                    },
                    error: '命令执行超时或被取消',
                });
            });

            let stdout = '';
            let stderr = '';

            child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
            child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

            child.on('close', (code) => {
                resolve({
                    success: code === 0,
                    data: {
                        command: params.command,
                        exitCode: code ?? -1,
                        stdout,
                        stderr,
                    },
                    error: code !== 0 ? stderr || `退出码: ${code}` : '',
                });
            });

            child.on('error', (err) => {
                resolve({
                    success: false,
                    data: {
                        command: params.command,
                        exitCode: -1,
                        stdout: '',
                        stderr: '',
                    },
                    error: `启动命令失败: ${err.message}`,
                });
            });
        });
    }
}