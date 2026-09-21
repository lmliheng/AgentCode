// src/test/task-runner.ts
//
// 批量任务跑批脚本。任务清单由使用者在本文件下方的 taskList 里自行填写。
//
// 运行：
//   npx tsx --env-file=.env src/test/task-runner.ts [工作区路径] [--resume[=会话ID]]
//   工作区路径省略时用当前目录（与 ds.test.ts 的约定一致）。
//   --resume 表示接上一个会话：不带值时接当前工作区「最近活跃」的那个，
//   带值时必须给出完整会话 ID。恢复只影响**第一条**任务 —— 它带着上一段对话
//   开始；后续任务仍是各自独立的新 run（整批共用一个会话的事件流）。
//
// 与 ds.example.ts 走同一条链路：DeepSeekProvider + ToolRegistry + AgentRuntime，
// 差别只是把「单条任务」换成「按 taskList 逐条跑」。
//
// 每条任务都会新建一个 AgentRuntime：runtime 的 state 里带着全部 decisions 与
// observations，复用同一个实例会让上一条任务的上下文进入下一条，测出来的
// token 与轮数就不是这条任务自己的了。
//
// 任务串行执行：它们共用同一个工作区，并行会互相踩文件。
//
// 它会发起真实模型调用，并且可能真的改动工作区里的文件。
// 请只对一次性副本运行，不要直接指向你正在编辑的工作树。



import { DeepSeekProvider } from '../provider/deepseek.provider.js';
import { AgentRuntime } from '../runtime/agent.runtime.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { config } from '../config/default.js';
import { SessionStore } from '../persistence/session-store.js';
import { formatSessionList, resolveResumeTarget } from '../persistence/resume.js';

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type Task = [title: string, task: string];

import { taskList } from './tasks.js'
import type { PriorRun } from '../types/Runtime.js';

const LOG_SUBDIR = path.join('run_test', 'log');

interface CliArgs {
    workspacePath: string;
    resume: boolean;
    resumeSessionId: string | undefined;
}

/**
 * 解析命令行。
 *
 * 位置参数仍是工作区路径（保持原有用法不变），`--resume` 是纯新增的开关；
 * 两者可以出现在任意顺序，因为这里按「是不是开关」分流，而不是按位置取。
 */
function parseArgs(argv: readonly string[]): CliArgs {
    const positional: string[] = [];
    let resume = false;
    let resumeSessionId: string | undefined;

    for (const arg of argv) {
        if (arg === '--resume') {
            resume = true;
            continue;
        }
        if (arg.startsWith('--resume=')) {
            resume = true;
            resumeSessionId = arg.slice('--resume='.length);
            continue;
        }
        positional.push(arg);
    }

    return { workspacePath: positional[0] ?? process.cwd(), resume, resumeSessionId };
}

/** 日志文件名前缀：月日时分，各两位。 */
function stamp(at: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(at.getMonth() + 1)}${pad(at.getDate())}${pad(at.getHours())}${pad(at.getMinutes())}`;
}

/** 去掉 Windows 文件名里的非法字符，避免 title 里出现 : / ? 时写盘失败。 */
function sanitize(title: string): string {
    const cleaned = title
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .replace(/[. ]+$/, '')
        .trim();
    return cleaned === '' ? 'task' : cleaned;
}

/**
 * 按「月日时分 + 标题.log」取名。同名文件已存在时加 `-2`、`-3` 递增后缀：
 * 时间戳只到分钟，同一分钟内重复跑、或清单里出现同名标题都会撞名，
 * 直接覆盖会把上一轮日志丢掉。
 */
function reserveLogPath(logDir: string, title: string, at: Date): string {
    const base = `${stamp(at)}${sanitize(title)}`;
    let candidate = path.join(logDir, `${base}.log`);
    for (let n = 2; existsSync(candidate); n++) {
        candidate = path.join(logDir, `${base}-${n}.log`);
    }
    return candidate;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const workspacePath = args.workspacePath;
    const logDir = path.join(process.cwd(), LOG_SUBDIR);
    await mkdir(logDir, { recursive: true });

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
        throw new Error(
            '缺少 DEEPSEEK_API_KEY。请用 `npx tsx --env-file=.env src/test/task-runner.ts` 运行。',
        );
    }

    // 会话：整批任务共用一个事件流，逐条 append。
    // `--resume` 时续写被恢复的那个会话（而不是新开一个），这样「接着聊」之后
    // 的历史仍然在同一个会话里。
    let session: SessionStore;
    let priorRuns: PriorRun[] | undefined;
    let sessionNote = '（新建）';

    if (args.resume) {
        const resolution = resolveResumeTarget(workspacePath, args.resumeSessionId);
        if (!resolution.ok) {
            console.error(`恢复失败（${resolution.reason}）：${resolution.message}`);
            console.error('可用会话：');
            console.error(formatSessionList(resolution.available));
            process.exitCode = 1;
            return;
        }

        session = new SessionStore(workspacePath, resolution.target.sessionId);
        priorRuns = resolution.target.runs;
        sessionNote = `（恢复，最后活跃 ${new Date(resolution.target.lastActiveAt).toLocaleString()}，历史 ${priorRuns.length} 条 run）`;

        const { stats } = resolution.target;
        if (stats.skippedUnknownType > 0 || stats.skippedMalformed > 0 || stats.orphaned > 0) {
            console.warn(
                `警告：历史里有 ${stats.skippedUnknownType} 条未知类型、` +
                `${stats.skippedMalformed} 条损坏、${stats.orphaned} 条孤儿事件被跳过。`,
            );
        }
        if (stats.summaryMismatches > 0) {
            console.warn(`警告：${stats.summaryMismatches} 条 run 的结束汇总与重放结果不一致。`);
        }
    } else {
        session = SessionStore.open(workspacePath);
    }

    console.log('工作区:  ', workspacePath);
    console.log('日志目录:', logDir);
    console.log('会话:    ', session.sessionId, sessionNote);
    console.log('任务数:  ', taskList.length);
    console.log('');

    // 工具无状态，整批共用一份注册表；每条任务只取一份新的数组快照。
    // 常驻白名单同时给注册表（决定 tool_search 能搜出什么）与运行时（决定声明哪些）。
    const registry = ToolRegistry.createDefault(config.tools.eager);

    let succeeded = 0;
    let isFirstTask = true;

    for (const [title, task] of taskList) {
        const startedAt = new Date();
        const logPath = reserveLogPath(logDir, title, startedAt);

        // 每条任务一个全新的 provider + runtime，避免上下文跨任务累积。
        const provider = new DeepSeekProvider({
            modelName: 'deepseek-chat',
            apiKey,
        });
        const runtime = new AgentRuntime(provider, registry.getAllTools(), {
            workspacePath,
            maxIterations: 100,
            timeoutMs: 60000,
            eagerTools: config.tools.eager,
            // 事件逐条落盘：写失败不会中断任务，但会在本条任务结束时被报出来
            onSessionEvent: (event) => session.append(event),
            // 只有第一条任务承接历史对话；后续任务是新的 run，不带上一段对话
            ...(isFirstTask && priorRuns !== undefined ? { priorRuns } : {}),
        });
        isFirstTask = false;

        console.log(`--- ${title} ---`);
        console.log('任务:    ', task);

        let payload: unknown;
        try {
            const result = await runtime.run(task);
            payload = result;
            succeeded++;

            const observations = result.state.observations;
            const ok = observations.filter((o) => o.result.success);
            console.log('停止原因:', JSON.stringify(result.state.stopReason));
            console.log('决策数:  ', result.state.decisions.length);
            console.log('成功观察:', ok.length, '/', observations.length);
            console.log('累计用量:', JSON.stringify(result.state.tokenUsage));
        } catch (err) {
            // 单条任务炸掉不该中断整批：写一份带 error 的 JSON 便于事后定位，
            // 然后继续下一条。它的形状与正常结果不同，解析时靠 error 字段区分。
            payload = {
                title,
                task,
                error: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
            };
            console.log('任务抛错:', err instanceof Error ? err.message : String(err));
        }

        // 会话事件写失败不中断任务，但也不能静默 —— 这里的告警是它在本次运行
        // 里的唯一出口（事件流已经在磁盘上了，缺的只是这一次的内容）。
        const persistence = runtime.getPersistenceStatus();
        if (persistence.degraded) {
            console.log('持久化:  降级 ——', persistence.error);
        }

        await writeFile(logPath, JSON.stringify(payload, null, 2), 'utf8');
        console.log('日志:    ', logPath);
        console.log('');
    }

    console.log(`完成: ${succeeded} / ${taskList.length} 条任务正常返回。`);
    console.log('会话:    ', session.sessionId);
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
