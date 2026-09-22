
import { execSync, type ExecSyncOptions, spawn, type ChildProcess } from 'child_process';
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
    description = `在工作区中执行 shell 命令，用于运行测试、编译、格式化、安装依赖等。

- 当前是 Windows，命令由 cmd.exe 执行：不支持 ; 分隔、$?、/tmp 这类 POSIX 语义，也没有 bash。& 只是顺序分隔符，不会因前一条失败而中断，用它拼接会在 exitCode 上掩盖前一条的失败。
- 命令阻塞执行，需要 stdin 交互的命令无法使用；需要长期驻留的服务类命令也不适合。
- 优先执行项目声明的脚本（如 npm test），不要自行拼装等价的底层命令。
- 返回 exitCode、stdout、stderr；判断成败看 exitCode，不要只凭输出里出现成功字样。
- 超时会杀掉整条命令进程树，已捕获的输出仍会返回；输出过长会被截断。`;

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
                command: { type: 'string', description: '要执行的命令，按 shell 语法解释' },
                cwd: { type: 'string', description: '工作目录（工作区内相对路径，默认为工作区根目录）' },
                timeout: { type: 'number', description: '超时时间（毫秒，默认 60000）；超时后会杀掉整条命令进程树', minimum: 1000, maximum: 300000 },
                env: { type: 'object', description: '附加环境变量，与当前进程环境合并' },
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

            const timeoutMs = params.timeout ?? 60000;

            const child = spawn(params.command, [], {
                shell: true,
                cwd: workDir,
                // POSIX 下需要自成进程组，才能整组杀掉；Windows 靠 taskkill /T，不能 detached
                detached: process.platform !== 'win32',
                env: {
                    ...process.env,
                    ...params.env,
                },
            });

            let stdout = '';
            let stderr = '';
            let settled = false;
            let timeoutId: ReturnType<typeof setTimeout> | undefined;

            const settle = (result: ToolResult) => {
                if (settled) return;
                settled = true;
                if (timeoutId !== undefined) clearTimeout(timeoutId);
                resolve(result);
            };

            // 超时与取消必须走同一个 kill 路径：两条路径都只允许生效一次，
            // 且都要把已捕获的输出带回去（否则超时后的报错会丢掉现场）。
            const killWithError = (error: string) => {
                if (settled) return;
                killProcessTree(child);
                settle({
                    success: false,
                    data: {
                        command: params.command,
                        exitCode: -1,
                        stdout,
                        stderr,
                    },
                    error,
                });
            };

            timeoutId = setTimeout(
                () => killWithError(`命令超时（${timeoutMs}ms）`),
                timeoutMs
            );

            // 监听取消信号
            ctx.signal?.addEventListener('abort', () => killWithError('命令执行被取消'));

            child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
            child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

            child.on('close', (code) => {
                settle({
                    success: code === 0,
                    data: {
                        command: params.command,
                        exitCode: code ?? -1,
                        stdout,
                        stderr,
                    },
                    error: code !== 0 ? stderr || `退出码: ${code}` : '',
                    // 只在这一条路径上给摘要：进程正常结束才拿得到真实退出码，
                    // 超时 / 启动失败 / 被取消的情形由 error 说清，再报一次
                    // 「exit -1」只是噪音。
                    display: `exit ${code ?? -1} · 输出 ${countOutputLines(stdout)} 行`,
                });
            });

            child.on('error', (err) => {
                settle({
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

/**
 * 输出行数。末尾的连续换行不算一行 —— 命令输出几乎总以换行收尾，
 * 照 `split('\n').length` 数会把每个命令都多报一行。
 */
function countOutputLines(text: string): number {
    const trimmed = text.replace(/\n+$/, '');
    return trimmed === '' ? 0 : trimmed.split('\n').length;
}

/**
 * 杀掉整棵进程树。
 *
 * spawn 开了 shell: true，命令实际是 shell 的子进程：只 kill shell 的话，
 * 真正在跑的命令会变成孤儿继续跑下去（Windows 上还会继续占住工作区目录）。
 */
function killProcessTree(child: ChildProcess): void {
    if (child.pid === undefined) return;

    if (process.platform === 'win32') {
        try {
            execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
        } catch {
            // 进程可能已经自己退出了
        }
        return;
    }

    try {
        process.kill(-child.pid, 'SIGKILL');
    } catch {
        try {
            child.kill('SIGKILL');
        } catch {
            // 进程可能已经自己退出了
        }
    }
}