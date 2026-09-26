// src/cli.ts
//
// 一个能真正跑起来的会话 CLI
//
// 运行：
//   开发中：  npm run cli -- [工作区路径] [选项]   （即 tsx --env-file=.env src/cli.ts）
//   装成包后：acode [工作区路径] [选项]           （构建产物 dist/cli.js，见 vite.cli.config.ts）
//
// API Key：先读环境变量 DEEPSEEK_API_KEY，没有才读用户级 .env（见 config/user-env.ts）。
// 开发时那个 .env 由 --env-file 传入，两者不冲突。
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
// 这正是「接着聊」。行首敲 `/` 会列出命令候选，`/help` 看命令表、`/quit` 退出。
//
// 与 task-runner 的差别：那个是批量跑一次性任务（每条任务独立上下文），
// 这个让上下文连贯地长下去，并把会话事件逐条落盘。
//
// 它会发起真实模型调用，并且可能真的改动工作区里的文件。请只对你愿意让它改的工作区运行。

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import chalk from 'chalk';

import { DeepSeekProvider } from './provider/deepseek.provider.js';
import { AgentRuntime } from './runtime/agent.runtime.js';
import { ToolRegistry } from './tools/ToolRegistry.js';
import { config } from './config/default.js';
import { loadUserEnvFile } from './config/user-env.js';

import { SessionStore, listSessions } from './persistence/session-store.js';
import { userEnvFile, normalizeWorkspaceRoot } from './persistence/paths.js';
import { formatSessionList, resolveResumeTarget } from './persistence/resume.js';

import { SLASH_COMMANDS, parseCommand, renderCommandHelp } from './utils/slash-commands.js';
import { displayWidth } from './utils/terminal-width.js';
import { InputAborted, readLine } from './utils/input-line.js';

import type { SlashCommand, SlashCommandHost } from './utils/slash-commands.js';
import type { SessionEventInput } from './persistence/events.js';
import type { ObservationPayload, DecisionPayload } from './persistence/events.js';
import type { PriorRun } from './types/Runtime.js';
import type { AgentRunState, ContextSizeMetric, StopReason } from './types/ReAct.js';
import type { PendingAction, ApprovalDecision } from './types/Tool.js';
import type { CliArgs } from './types/Args.js'

import { parseArgs } from './utils/ParseArgs.js'



const USAGE = `用法: acode [工作区路径] [选项]

选项:
  --resume[=会话ID]   接上一个会话（不带 ID 时接本工作区最后活跃的那个）
  --list              只列出本工作区的会话，然后退出
  --task "任务"       只跑一条任务然后退出（不进入交互）
  --model 名称        模型名，默认 deepseek-chat
  --max-iterations N  单条任务的循环上限，默认 50
  --dev               逐轮打印送入模型的输入量与缓存命中量
  --help              打印本用法

${renderCommandHelp(SLASH_COMMANDS)}`;


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
 * 取当前可用的 API Key。
 *
 * 每轮任务前现读 `process.env`，而不是启动时抄一份留着用：`/auth` 改的正是这个
 * 环境变量，抄一份会让新 key 到下次启动才生效 —— 而它就是为了立刻生效才写的。
 */
function requireApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new Error(
      '缺少 DEEPSEEK_API_KEY。请把它设为环境变量，或写入：\n' +
      `  ${userEnvFile()}\n` +
      '（文件格式为 KEY=value 一行。）',
    );
  }
  return key;
}

/**
 * 把 API Key 写进用户级 .env，并让它对当前进程立刻生效。
 *
 * 只替换 `DEEPSEEK_API_KEY` 那一行，其余内容原样保留：这个文件是用户的配置文件
 * 而不是本应用的私有文件（`loadUserEnvFile` 会把里面**所有**键都装进环境），
 * 整份覆写等于替用户删掉别人的变量。
 *
 * 注意它不一定能决定下次启动用哪个 key：环境变量优先，若 DEEPSEEK_API_KEY 本来
 * 就由环境给出，这里写的值会被它盖住。/auth 会把这件事说清楚（见 apiKeyStatus）。
 */
function writeUserEnvKey(key: string): void {
  const file = userEnvFile();
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';

  const kept = existing
    .split(/\r?\n/)
    .filter((line) => !/^\s*DEEPSEEK_API_KEY\s*=/.test(line))
    // split 在末尾有换行的文件上会多出一个空串，自己收掉，避免越写越空
    .filter((line, index, lines) => !(line === '' && index === lines.length - 1));

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, [...kept, `DEEPSEEK_API_KEY=${key}`, ''].join('\n'), 'utf8');

  process.env.DEEPSEEK_API_KEY = key;
}


// ---------------------------------------------------------------------------
// 终端呈现
//
// 这一节只负责「怎么让人看懂」，不参与任何运行决策：停止原因、用量、缓存命中量
// 在这里被翻译成文案与颜色，机器可读的字段本身原样保留在 state 与事件流里。
// ---------------------------------------------------------------------------

/**
 * 语气的语义档位。
 *
 * 调用点只说「这是好消息还是坏消息」，具体颜色由这里统一决定 —— 否则同一件事
 * 在不同地方会写成不同颜色。
 */
export type Tone = 'ok' | 'warn' | 'bad' | 'note';

const TONE_PAINT: Record<Tone, (text: string) => string> = {
  ok: chalk.green,
  warn: chalk.yellow,
  bad: chalk.red,
  note: chalk.dim,
};

const TONE_MARK: Record<Tone, string> = {
  ok: '✓',
  warn: '!',
  bad: '✗',
  note: ' ',
};

export function paint(tone: Tone, text: string): string {
  return TONE_PAINT[tone](text);
}

/** 带语气标记的文案。标记用 ASCII 与半角符号，避免歧义宽度把边框顶歪 */
function marked(tone: Tone, text: string): string {
  return paint(tone, `${TONE_MARK[tone]} ${text}`);
}

/**
 * 画一个带标题的信息块。
 *
 * 宽度只由内容决定，不去查 `process.stdout.columns`：那个值在管道与非 TTY 下拿不到，
 * 按它排版反而会在重定向到文件时错位。宁可块宽一点，也不要参差不齐。
 *
 * 显示宽度（中文与全角标点占两列）由 utils/terminal-width 统一算 ——
 * 输入行折行与候选菜单也要用同一份，所以那一层不在这个文件里。
 */
export function panel(title: string, rows: ReadonlyArray<readonly [string, string]>): string {
  const labelWidth = rows.reduce((max, [label]) => Math.max(max, displayWidth(label)), 0);
  const body = rows.map(([label, value]) =>
    `${label}${' '.repeat(labelWidth - displayWidth(label))}  ${value}`,
  );
  const inner = Math.max(displayWidth(title) + 3, ...body.map((line) => displayWidth(line)));

  const head =
    chalk.dim('╭─ ') +
    chalk.bold.cyan(title) +
    chalk.dim(` ${'─'.repeat(Math.max(2, inner - displayWidth(title) - 1))}╮`);
  const lines = body.map((line) => `│ ${line}${' '.repeat(inner - displayWidth(line))} │`);
  const foot = chalk.dim(`╰${'─'.repeat(inner + 2)}╯`);

  return [head, ...lines, foot].join('\n');
}



/** 毫秒转人读时长 */
function formatDuration(ms: number): string {
  if (ms >= 60_000) return `${Math.round(ms / 60_000)} 分钟`;
  return `${Math.max(1, Math.round(ms / 1000))} 秒`;
}

/**
 * 把机器可读的停止原因翻成人话。
 *
 * 只做翻译，不改动 `StopReason` —— trace 与事件流里仍然是结构化字段。
 * 不在这里拼 ANSI：这里只给语义档位，上色由调用点决定，于是这个函数可以直接断言。
 */
export function describeStopReason(reason: StopReason | undefined): { text: string; tone: Tone } {
  if (reason === undefined) return { text: '未记录停止原因', tone: 'note' };

  switch (reason.type) {
    case 'task_completed':
      return { text: '任务完成', tone: 'ok' };
    case 'max_iterations':
      return { text: `达到迭代上限（${reason.limit} 轮）`, tone: 'warn' };
    case 'max_tool_calls':
      return { text: `达到工具调用上限（${reason.limit} 次）`, tone: 'warn' };
    case 'max_file_changes':
      return { text: `文件变更达到上限（${reason.limit} 处）`, tone: 'warn' };
    case 'timeout':
      return { text: `超过时间上限（${formatDuration(reason.durationMs)}）`, tone: 'warn' };
    case 'user_interrupted':
      return { text: '用户中断', tone: 'note' };
    case 'error':
      return { text: `异常停止：${reason.message}`, tone: 'bad' };
  }
}



/**
 * 当前上下文大小的展示。
 *
 * 「累计消耗」与「当前上下文」是两个差着数倍的口径，混着看会严重误判成本；
 * 来源必须一起显示 —— 实测与估算的可信度不同，看不出区别就等于没有区别。
 */
export function describeContextSize(metric: ContextSizeMetric): string {
  if (metric.tokens === null) return '未知';

  const source = metric.source === 'measured' ? '实测' : metric.source === 'estimated' ? '估算' : '未知';
  return `${formatCount(metric.tokens)} tokens（${source}）`;
}

/** 展示缓存命中量所需的最小形状：累计记录与单轮用量都满足 */
interface CacheUsageView {
  promptTokens: number;
  cacheHitTokens: number | null;
  cacheMissTokens: number | null;
}

/**
 * 缓存命中量的展示。
 *
 * 拿不到时说「未报告」而不是显示 0：显示 0 会被读成「缓存一次都没命中」，
 * 而真实情况可能只是响应没带这个数。命中率按输入量算，它是唯一的分母。
 *
 * 命中率本身带上语气档位：它是「重发历史划不划算」最直接的读数，
 * 高命中意味着压缩历史省下的是最便宜的那部分 token。
 */
export function describeCacheUsage(usage: CacheUsageView): { text: string; tone: Tone } {
  if (usage.cacheHitTokens === null) return { text: '未报告', tone: 'note' };

  const miss = usage.cacheMissTokens === null ? '未知' : formatCount(usage.cacheMissTokens);
  const hit = formatCount(usage.cacheHitTokens);
  const rate = usage.promptTokens > 0 ? usage.cacheHitTokens / usage.promptTokens : null;

  if (rate === null) return { text: `命中 ${hit} / 未命中 ${miss}`, tone: 'note' };

  // 档位取值对齐 qwen-code 的 getCacheColor()（≥85% 正常 / ≥70% 警告 / 其余异常）：
  // 稳定前缀（系统提示 + 工具声明）通常占输入的绝大多数，命中率天然偏高，
  // 所以「一半命中」在这个场景里已经是不正常的信号，不该被当成轻微提醒。
  const tone: Tone = rate >= 0.85 ? 'ok' : rate >= 0.7 ? 'warn' : 'bad';
  return {
    text: `命中 ${hit} / 未命中 ${miss} · 命中率 ${(rate * 100).toFixed(1)}%`,
    tone,
  };
}



/** 单轮用量转成展示形状：TokenUsage 用 undefined 表示「没报告」，展示层用 null */
export function viewOfRoundUsage(usage: {
  promptTokens: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
}): CacheUsageView {
  return {
    promptTokens: usage.promptTokens,
    cacheHitTokens: usage.cacheHitTokens ?? null,
    cacheMissTokens: usage.cacheMissTokens ?? null,
  };
}



/**
 * 一次工具观察的标题：工具名 + 该工具自己产出的执行细节。
 *
 * 细节来自 `ToolResult.display`（见该字段的说明），例如
 * 「read_file src/cli.ts 第 12–45 行 / 共 320 行」。工具没写就退回只有工具名的
 * 形式 —— 新工具、或将来接入的 MCP 工具，不写 display 不能因此变成哑巴。
 */
export function describeObservation(tool: string, display: string | undefined): string {
  const detail = display?.trim();
  return detail ? `${tool} ${detail}` : tool;
}




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

  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (args.list) {
    const sessions = listSessions(workspacePath);
    console.log(`${chalk.dim('工作区')} ${workspacePath}`);
    console.log(formatSessionList(sessions));
    return;
  }

  // 环境变量优先；没有才去读用户级 .env。
  // 全局安装后没有 npm script 帮忙传 --env-file，而那个参数相对当前工作目录解析，
  // 在用户任意目录下敲命令时指不到家目录里的文件，所以这里自己加载。
  //
  // 读之前先记一笔「环境里本来有没有」：/auth 要据此说清写进文件到底生不生效
  // （环境变量优先，文件里的值会被环境里的值盖住）。读过之后就分辨不出来了。
  const keyFromEnvironment = process.env.DEEPSEEK_API_KEY !== undefined;
  loadUserEnvFile();

  // 启动时先确认能拿到 key：别让用户配了半天才发现缺。
  // 每轮任务前会再查一次（见 requireApiKey），/auth 换过的 key 要立刻生效。
  requireApiKey();

  // ---- 会话：续写被恢复的那个，或新开一个 ----
  let session: SessionStore;
  let history: PriorRun[] = [];
  let sessionNote = '（新建）';

  if (args.resume) {
    const resolution = resolveResumeTarget(workspacePath, args.resumeSessionId);
    if (!resolution.ok) {
      console.error(chalk.red(`恢复失败（${resolution.reason}）：${resolution.message}`));
      console.error(chalk.dim('可用会话：'));
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

  let shuttingDown = false;

  // 交互式下不建 readline 实例：它一建起来就把 stdin 的按键整个接管，
  // 会和自带候选菜单的输入组件抢同一份按键。只有非交互（管道、脚本）才需要它 ——
  // 那里没有按键事件，也没有列宽，谈不上菜单。
  const interactive = stdin.isTTY === true && stdout.isTTY === true;
  const pipeTerminal = interactive
    ? null
    : createInterface({ input: stdin, output: stdout, terminal: true });

  if (pipeTerminal !== null) {
    const piped = pipeTerminal;
    piped.on('SIGINT', () => {
      shuttingDown = true;
      piped.close();
    });
  }

  /**
   * 读一行输入。
   *
   * 审批问答不传 commands，于是那条路上没有菜单 —— 它不需要命令表。
   * Ctrl+C 在这里表现为 InputAborted，由调用方决定是退出会话还是中止这一轮。
   */
  async function askUser(prompt: string, commands?: readonly SlashCommand[]): Promise<string> {
    if (pipeTerminal !== null) return pipeTerminal.question(prompt);

    return commands === undefined ? readLine({ prompt }) : readLine({ prompt, commands });
  }

  /**
   * 会话的归属工作区。
   *
   * 它在会话创建时就定死了（分区目录名是工作区路径的哈希），`/cd` 不会把它搬走。
   * 所以事件落盘、`/session`、`--resume` 一律按这个值，而「任务实际读写哪个目录」
   * 按 `host.state.workspace`。两者一旦不同，/cd 会当场把这件事说出来。
   */
  const sessionWorkspace = workspacePath;

  /** 命令表要用的外部能力：会话存储、用法文本、退出信号都在这里注入 */
  const host: SlashCommandHost = {
    print: (text) => console.log(text),
    exit: () => {
      shuttingDown = true;
    },
    sessions: () => formatSessionList(listSessions(sessionWorkspace)),
    usage: () => USAGE,

    state: {
      model: args.model,
      workspace: workspacePath,
    },

    // 切之前先验：切到一个不存在的地方，比拒绝切换更难查（每个工具都开始报错）
    switchWorkspace: (path) => {
      const target = normalizeWorkspaceRoot(path);
      try {
        if (!statSync(target).isDirectory()) return { ok: false, reason: `${target} 不是目录` };
      } catch {
        return { ok: false, reason: `${target} 不存在或读不到` };
      }
      return { ok: true, path: target };
    },

    apiKeyStatus: () =>
      keyFromEnvironment
        ? 'API Key 来自环境变量 DEEPSEEK_API_KEY' +
          chalk.dim(`（环境变量优先，写入 ${userEnvFile()} 不会盖过它）`)
        : `API Key 来自用户级文件 ${userEnvFile()}`,

    saveApiKey: (key) => {
      try {
        writeUserEnvKey(key);
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: (error as Error).message };
      }
    },

    // 掩码输入：TTY 下走自带输入组件的打码模式，非 TTY 只能交给 readline
    askSecret: (prompt) =>
      pipeTerminal !== null ? pipeTerminal.question(prompt) : readLine({ prompt, mask: true }),
  };



  console.log(panel('会话', [
    ['工作区', host.state.workspace],
    ['会话', `${session.sessionId}  ${chalk.dim(sessionNote)}`],
    ['模型', `${host.state.model}  ${chalk.dim(`· 迭代上限 ${args.maxIterations} 轮`)}`],
  ]));
  console.log(chalk.dim('输入 /help 看命令，/quit 退出；行首敲 / 会列出候选'));
  if (args.dev) console.log(chalk.dim('dev 参数:'), args);
  console.log('');

  /** 每轮一个全新的 runtime：state 不跨轮复用，历史靠 history 传递 */
  async function runOne(task: string): Promise<void> {
    // 模型与 key 每轮现取：/model 与 /auth 只改会话配置，改完的下一轮就该用上新值
    const provider = new DeepSeekProvider({
      apiKey: requireApiKey(),
      modelName: host.state.model,
    });

    /**
     * 流式输出的落点：模型每产出一段正文就直接写到终端。
     *
     * `roundStreamedText` 是「这一轮已经流出过正文」的标记，观察一出现就清零 ——
     * 观察意味着上一轮已经说完、新一轮从此开始。它决定最后要不要补打答案：
     * 已经流出来的不能再打一遍。
     *
     * `atLineStart` 管换行。流出来的正文通常不以换行结尾，而工具行和结果块都是
     * 整行输出，不先补换行就会和正文粘在同一行上。
     */
    let roundStreamedText = false;
    let atLineStart = true;

    const ensureNewline = (): void => {
      if (atLineStart) return;
      // 换两行
      process.stdout.write('\n\n');
      atLineStart = true;
    };

    const runtime = new AgentRuntime(provider, tools, {
      workspacePath: host.state.workspace,
      maxIterations: args.maxIterations,
      eagerTools: config.tools.eager,
      priorRuns: history,
      onStreamDelta: (delta) => {
        // 思考链 本轮不渲染：deepseek-chat 不返回它，等切到 thinking 模型再给它一块区域
        const text = delta.content;
        if (!text) return;
        process.stdout.write(text);
        atLineStart = text.endsWith('\n');
        roundStreamedText = true;
      },

      // 事件逐条落盘；顺带把工具调用打给用户看，否则一轮跑几分钟是静默的
      onSessionEvent: (event: SessionEventInput) => {
        session.append(event);

        if (event.type === 'observation') {
          // 新一轮开始：上一轮流出来的正文到此为止
          ensureNewline();
          roundStreamedText = false;
          const { observation } = event.payload as ObservationPayload;
          const mark = observation.result.success
            ? chalk.green('✓')
            : chalk.red(`✗ ${observation.result.error ?? ''}`);
          // 细节由工具自己产出（见 ToolResult.display），CLI 只负责摆位置
          const label = describeObservation(observation.action.tool, observation.result.display);
          console.log(`  ${chalk.dim('·')} ${chalk.cyan(label)} ${mark}`);
        }

        // --dev 才逐轮打印：一轮一行在长任务里会把工具观察淹掉。
        // 首轮必然全部未命中、之后的轮次才开始命中 —— 这个爬坡过程只有逐轮看才看得到。
        if (args.dev && event.type === 'decision') {
          const { usage, contextSize } = event.payload as DecisionPayload;
          if (usage) {
            ensureNewline();
            const cache = describeCacheUsage(viewOfRoundUsage(usage));
            const source = contextSize?.source === 'measured' ? '' : chalk.dim(' [估算]');
            console.log(
              `  ${chalk.dim('·')} ${chalk.dim('输入')} ${formatCount(usage.promptTokens)} ` +
              `${chalk.dim('| 缓存')} ${paint(cache.tone, cache.text)}${source}`,
            );
          }
        }
      },
      // 需要审批的工具必须由人拍板：没有交互层时运行时只会自动放行
      requestApproval: async (action: PendingAction): Promise<ApprovalDecision> => {
        const files = action.preview.affectedFiles
          .map((file) => `    ${file.changeType} ${file.path}`)
          .join('\n');
        ensureNewline();
        console.log('');
        console.log(`需要确认：[${action.preview.riskLevel}] ${action.preview.summary}`);
        if (files !== '') console.log(files);

        const answer = await askUser('允许执行吗？(y/N) ');
        return answer.trim().toLowerCase().startsWith('y') ? 'approve' : 'reject';
      },
    });

    const result = await runtime.run(task);

    const last = result.state.decisions[result.state.decisions.length - 1];
    if (last?.type === 'Final') {
      // 已经流出来的正文不再打第二遍。只有这一轮什么都没流出来时才补打 ——
      // 例如流式被关掉，或模型这一轮确实没产出正文（此时 answer 是兜底文案）。
      if (roundStreamedText) {
        ensureNewline();
      } else {
        console.log('');
        console.log(last.answer);
      }
    }

    const { tokenUsage: usage, contextSize } = result.state;
    const stop = describeStopReason(result.state.stopReason);
    const cache = describeCacheUsage(usage);

    ensureNewline();

    console.log('');
    console.log(panel('本轮结果', [
      ['停止', marked(stop.tone, stop.text)],
      ['决策', `${result.state.decisions.length} 轮 ${chalk.dim('·')} 工具 ${result.state.toolCallCount} 次`],
      ['消耗', `${formatCount(usage.totalTokens)} tokens ` +
        chalk.dim(`（输入 ${formatCount(usage.promptTokens)} / 输出 ${formatCount(usage.completionTokens)}）`)],
      ['缓存', paint(cache.tone, cache.text)],
      ['上下文', describeContextSize(contextSize)],
    ]));

    if (usage.complete === false) {
      console.log(chalk.yellow('  ! 本轮有缺失的用量统计，累计值不完整'));
    }
    if (usage.cacheComplete === false && usage.cacheHitTokens !== null) {
      console.log(chalk.yellow('  ! 部分轮次未报告缓存命中量，上面的缓存数为偏低值'));
    }

    const persistence = runtime.getPersistenceStatus();
    if (persistence.degraded) {
      console.log(chalk.red(`  ✗ 持久化降级：${persistence.error}`));
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
      let line: string;
      try {
        line = (await askUser('> ', SLASH_COMMANDS)).trim();
      } catch (error) {
        // 在提示符上按 Ctrl+C 就是退出会话，跟终端里的习惯一致
        if (error instanceof InputAborted) break;
        throw error;
      }

      if (line === '') continue;

      // 命令名不在表里的（例如 `/tmp/x 里有什么` 这种绝对路径）照常当任务送给模型
      const parsed = parseCommand(SLASH_COMMANDS, line);
      if (parsed !== null) {
        try {
          await parsed.command.run(parsed.arg, host);
        } catch (error) {
          // 命令自己要用户输入时（/auth 读密钥），Ctrl+C 会从输入组件抛到这里。
          // 那只是取消这一条命令，不该把整个会话带走。
          if (error instanceof InputAborted) console.log(chalk.dim('已取消'));
          else console.error(`命令 /${parsed.command.name} 失败: ${(error as Error).message}`);
        }
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
    pipeTerminal?.close();
    console.log('');
    console.log(`${chalk.dim('会话')} ${chalk.cyan(session.sessionId)}`);
    console.log(
      chalk.dim('接着聊：') +
      chalk.cyan(`acode --resume=${session.sessionId}`),
    );
  }
}

/**
 * 是否作为入口脚本直接被运行。
 *
 * 只作为脚本运行时才启动，便于测试直接 import 这里的视图函数。
 *
 * 必须按**真实路径**比较，不能拿文件名去匹配。原来那句
 * `argv[1].endsWith('/src/cli.ts')` 只对源码路径成立：装成包之后入口是
 * `dist/cli.js`，匹配失败会让 main() 静默不执行 —— 表现为「命令装上了，
 * 敲下去什么都不做」，是最难排查的一种坏法。
 *
 * 两侧都取 realpath：全局安装的 shim 可能经符号链接才到达真正的文件。
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;

  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    // argv[1] 指向不存在的路径（例如 node -e）时按「不是入口」处理
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
