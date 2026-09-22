// src/test/cli.ts
//
// 一个能真正跑起来的会话 CLI
//
// 运行：
//   npx tsx --env-file=.env src/test/cli.ts [工作区路径] [选项]
//
// 选项：
//   --resume[=会话ID]   接上一个会话（不带 ID 时接本工作区最后活跃的那个）
//   --list              只列出本工作区的会话，然后退出
//   --task "任务"       只跑一条任务然后退出（不进入交互）
//   --model 名称        模型名，默认 deepseek-chat
//   --max-iterations N  单条任务的循环上限，默认 50
//   --help              打印用法
//
// 默认进入交互：每输入一行就是**一次新的 run**，但历史对话在同一个会话里累积 ——
// 这正是「接着聊」。输入 :q 退出、:sessions 列会话、:help 看命令。
//
// 与 task-runner 的差别：那个是批量跑一次性任务（每条任务独立上下文），
// 这个让上下文连贯地长下去，并把会话事件逐条落盘。
//
// 它会发起真实模型调用，并且可能真的改动工作区里的文件。请只对你愿意让它改的工作区运行。

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { DeepSeekProvider } from '../provider/deepseek.provider.js';
import { AgentRuntime } from '../runtime/agent.runtime.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { config } from '../config/default.js';

import { SessionStore, listSessions } from '../persistence/session-store.js';
import { formatSessionList, resolveResumeTarget } from '../persistence/resume.js';

import type { SessionEventInput } from '../persistence/events.js';
import type { ObservationPayload } from '../persistence/events.js';
import type { PriorRun } from '../types/Runtime.js';
import type { AgentRunState } from '../types/ReAct.js';
import type { PendingAction, ApprovalDecision } from '../types/Tool.js';
import type { CliArgs } from '../types/Args.js'

import { parseArgs } from '../utils/ParseArgs.js'



const USAGE = `用法: tsx --env-file=.env src/test/cli.ts [工作区路径] [选项]

选项:
  --resume[=会话ID]   接上一个会话（不带 ID 时接本工作区最后活跃的那个）
  --list              只列出本工作区的会话，然后退出
  --task "任务"       只跑一条任务然后退出（不进入交互）
  --model 名称        模型名，默认 deepseek-chat
  --max-iterations N  单条任务的循环上限，默认 50
  --help              打印本用法

交互命令:
  :q, exit, quit      退出
  :sessions           列出本工作区的会话
  :help               打印本用法`;


/**
 * 把一次跑完的 run 转成历史。
 *
 * 这是「同一个进程里接着聊」的关键：`run()` 每次都会用新的 state 覆盖旧的，
 * 所以上一轮的决定与观察必须由调用方留存下来，下一轮再作为 priorRuns 交回去。
 */
function priorRunOf(state: AgentRunState, taskDescription: string): PriorRun {
  return {
    taskDescription,
    plan: state.plan,
    decisions: state.decisions,
    observations: state.observations,
  };
}


function formatCount(n: number): string {
  return n.toLocaleString();
}


/**
 * 
 * @
 * 1. 需要支持/
 */

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    console.error('');
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const workspacePath = args.workspacePath;

  // console.log(args)
  // debug
  if (args.dev) {
    console.log(args)
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (args.list) {
    const sessions = listSessions(workspacePath);
    console.log(`工作区: ${workspacePath}`);
    console.log(formatSessionList(sessions));
    return;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 DEEPSEEK_API_KEY。请用 `npx tsx --env-file=.env src/test/cli.ts` 运行。');
  }

  // ---- 会话：续写被恢复的那个，或新开一个 ----
  let session: SessionStore;
  let history: PriorRun[] = [];
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
    history = [...resolution.target.runs];
    sessionNote =
      `（恢复，最后活跃 ${new Date(resolution.target.lastActiveAt).toLocaleString()}，` +
      `历史 ${history.length} 条 run）`;

    const { stats } = resolution.target;
    if (stats.skippedUnknownType > 0 || stats.skippedMalformed > 0 || stats.orphaned > 0) {
      console.warn(
        `警告：历史里有 ${stats.skippedUnknownType} 条未知类型、` +
        `${stats.skippedMalformed} 条损坏、${stats.orphaned} 条孤儿事件被跳过。`,
      );
    }
  } else {
    session = SessionStore.open(workspacePath);
  }

  const registry = ToolRegistry.createDefault(config.tools.eager);
  const tools = registry.getAllTools();

  const terminal = createInterface({ input: stdin, output: stdout });
  let shuttingDown = false;
  terminal.on('SIGINT', () => {
    shuttingDown = true;
    terminal.close();
  });

  console.log('会话模式：');
  console.log('工作区:', workspacePath);
  console.log('会话:  ', session.sessionId, sessionNote);
  console.log(`模型:   ${args.model}`);
  console.log('输入 :help 看命令，:q 退出。');
  console.log('');

  /** 每轮一个全新的 runtime：state 不跨轮复用，历史靠 history 传递 */
  async function runOne(task: string): Promise<void> {
    const provider = new DeepSeekProvider({ apiKey: apiKey!, modelName: args.model });

    const runtime = new AgentRuntime(provider, tools, {
      workspacePath,
      maxIterations: args.maxIterations,
      eagerTools: config.tools.eager,
      priorRuns: history,
      // 事件逐条落盘；顺带把工具调用打给用户看，否则一轮跑几分钟是静默的
      onSessionEvent: (event: SessionEventInput) => {
        session.append(event);
        if (event.type === 'observation') {
          const { observation } = event.payload as ObservationPayload;
          const mark = observation.result.success ? '✓' : '✗';
          const detail = observation.result.success ? '' : ` ${observation.result.error ?? ''}`;
          console.log(`  · ${observation.action.tool} ${mark}${detail}`);
        }
      },
      // 需要审批的工具必须由人拍板：没有交互层时运行时只会自动放行
      requestApproval: async (action: PendingAction): Promise<ApprovalDecision> => {
        const files = action.preview.affectedFiles
          .map((file) => `    ${file.changeType} ${file.path}`)
          .join('\n');
        console.log('');
        console.log(`需要确认：[${action.preview.riskLevel}] ${action.preview.summary}`);
        if (files !== '') console.log(files);

        const answer = await terminal.question('允许执行吗？(y/N) ');
        return answer.trim().toLowerCase().startsWith('y') ? 'approve' : 'reject';
      },
    });

    const result = await runtime.run(task);

    const last = result.state.decisions[result.state.decisions.length - 1];
    if (last?.type === 'Final') {
      console.log('');
      console.log(last.answer);
    }

    console.log('');
    console.log(
      `  停止: ${JSON.stringify(result.state.stopReason)} | 决策 ${result.state.decisions.length} | ` +
      `工具 ${result.state.toolCallCount} | token ${formatCount(result.state.tokenUsage.totalTokens)}`,
    );
    if (result.state.tokenUsage.complete === false) {
      console.log('  注意：本轮有缺失的用量统计，累计值不完整。');
    }

    const persistence = runtime.getPersistenceStatus();
    if (persistence.degraded) {
      console.log(`  持久化降级：${persistence.error}`);
    }

    // 这一轮成为下一轮的历史
    history.push(priorRunOf(result.state, task));
  }

  try {
    // 一次性模式：跑完就走，适合脚本里调
    if (args.task !== undefined) {
      await runOne(args.task);
      return;
    }

    while (!shuttingDown) {
      const line = (await terminal.question('> ')).trim();
      if (line === '') continue;

      if (line === ':q' || line === 'exit' || line === 'quit') break;

      if (line === ':sessions') {
        console.log(formatSessionList(listSessions(workspacePath)));
        continue;
      }

      if (line === ':help') {
        console.log(USAGE);
        continue;
      }

      try {
        await runOne(line);
      } catch (error) {
        // 一条任务炸掉不该让整个会话退场：历史已经落盘，接着说就是
        console.error(`本轮失败: ${(error as Error).message}`);
      }
    }
  } finally {
    terminal.close();
    console.log('');
    console.log(`会话: ${session.sessionId}`);
    console.log(`恢复它：tsx --env-file=.env src/test/cli.ts --resume=${session.sessionId}`);
  }
}

// 只作为脚本运行时才启动，便于测试直接 import parseArgs
const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('/src/test/cli.ts') ?? false;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
