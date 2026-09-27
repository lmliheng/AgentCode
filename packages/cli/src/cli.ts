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
//   --max-tokens N      累计 token 上限（成本闸门），达到即停；默认不限制
//   --output-format F   输出形态（text / json / stream-json），只与 --task 一起用
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
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import chalk from 'chalk';

import { DeepSeekProvider } from '@lmliheng/acode-providers';
import { AgentRuntime } from '@lmliheng/acode-runtime';
import { loadProjectInstructions } from '@lmliheng/acode-runtime';
import { ToolRegistry } from '@lmliheng/acode-tools';
import { MCP_CONFIG_EXAMPLE, connectMcpServers, loadMcpConfig } from '@lmliheng/acode-tools';
import { config } from '@lmliheng/acode-core';
import { loadUserEnvFile } from '@lmliheng/acode-core';

import { SessionStore, listSessions } from '@lmliheng/acode-core';
import { userEnvFile, normalizeWorkspaceRoot } from '@lmliheng/acode-core';
import { formatSessionList, resolveResumeTarget } from '@lmliheng/acode-core';
import { deleteSession, renderSessionMarkdown } from '@lmliheng/acode-core';

import { SLASH_COMMANDS, parseCommand, renderCommandHelp } from './utils/slash-commands.js';
import { displayWidth } from './utils/terminal-width.js';
import { InputAborted, readLine } from './utils/input-line.js';

import type { SlashCommand, SlashCommandHost } from './utils/slash-commands.js';
import type { SessionEventInput } from '@lmliheng/acode-core';
import type { ObservationPayload, DecisionPayload } from '@lmliheng/acode-core';
import type { PriorRun } from '@lmliheng/acode-core';
import type { AgentRunState, ContextSizeMetric, StopReason, TaskVerificationResult } from '@lmliheng/acode-core';
import type { PendingAction, ApprovalDecision } from '@lmliheng/acode-core';
import type { CliArgs } from '@lmliheng/acode-core'
import type { McpConfigLoad, McpConnectedServer } from '@lmliheng/acode-tools';

import { parseArgs } from './utils/ParseArgs.js'



const USAGE = `用法: acode [工作区路径] [选项]

选项:
  --resume[=会话ID]   接上一个会话（不带 ID 时接本工作区最后活跃的那个）
  --list              只列出本工作区的会话，然后退出
  --task "任务"       只跑一条任务然后退出（不进入交互）
  --model 名称        模型名，默认 deepseek-chat
  --max-iterations N  单条任务的循环上限，默认 50
  --max-tokens N      累计 token 上限（成本闸门），达到即停；默认不限制
  --output-format F   输出形态，只与 --task 一起用：
                        text         人读（默认）
                        json         结束时一行 JSON 结果，不打印其他内容
                        stream-json  会话事件逐行 NDJSON，最后一行是结果
  --yes               不询问，自动批准需要审批的动作（无人值守脚本用）
  --dev               逐轮打印送入模型的输入量与缓存命中量
  --help              打印本用法

退出码（仅 --task 模式）：任务完成且验收没有判不通过时为 0，否则为 1；用法错误为 1。
结构化输出下无人可问审批，需要审批的动作默认按拒绝处理（记录在结果的 approvals 里）；
确实要让它改文件时显式加 --yes。

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
    case 'max_tokens':
      return { text: `达到 token 上限（${formatCount(reason.limit)}）`, tone: 'warn' };
    case 'max_file_changes':
      return { text: `文件变更达到上限（${reason.limit} 处）`, tone: 'warn' };
    case 'timeout':
      return { text: `超过时间上限（${formatDuration(reason.durationMs)}）`, tone: 'warn' };
    case 'no_progress':
      return { text: `无进展停止：${reason.tool} 连续 ${reason.repeats} 次产出相同结果`, tone: 'warn' };
    case 'user_interrupted':
      return { text: '用户中断', tone: 'note' };
    case 'error':
      return { text: `异常停止：${reason.message}`, tone: 'bad' };
  }
}



/**
 * 验收结论的展示。
 *
 * 分两层说，因为两层回答不同的问题：回归测试 = 「没弄坏原来的东西」，
 * 交付物 = 「这次要的东西出来了没有」。只给一个通过/不通过，会让人以为
 * 测试全绿就等于任务完成 —— 老实现正是如此（没有交付物这一层）。
 *
 * 不通过时把缺哪条列出来：光说「失败」的话，用户还得回去翻 trace 才知道缺什么。
 */
export function describeVerification(
  verification: TaskVerificationResult | undefined,
): { text: string; tone: Tone } | null {
  if (verification === undefined) return null;

  if (verification.verificationStatus === 'unavailable') {
    return { text: '不可判定（没有测试脚本，本次也没声明交付物）', tone: 'note' };
  }

  // 老会话重放出来的记录没有 layers / deliverables 字段，取不到就不摆这一层
  const regression = verification.layers?.regression;
  const deliverableLayer = verification.layers?.deliverables;
  const checks = verification.deliverables ?? [];

  const parts: string[] = [];
  if (regression?.executed) {
    parts.push(`回归测试${regression.passed ? '通过' : '失败'}`);
  }
  if (deliverableLayer !== undefined && deliverableLayer.declared > 0) {
    const ok = checks.filter((check) => check.ok).length;
    parts.push(`交付物 ${ok}/${deliverableLayer.declared} 通过`);
  }

  const missing = checks.filter((check) => !check.ok).map((check) => check.path);
  if (missing.length > 0) parts.push(`缺：${missing.join('、')}`);

  return {
    text: `${parts.join(' · ')}（${verification.passed ? '整体通过' : '整体不通过'}）`,
    tone: verification.passed ? 'ok' : 'bad',
  };
}

/**
 * 这次运行算不算成功 —— 进程退出码的唯一依据。
 *
 * 只判两件事：停止原因是不是「完成」，以及验收有没有给出反例。
 * 「验收不可判定」（工作区既没有测试、任务也没声明交付物）不算失败：它是**没法判**，
 * 不是**判为失败**。这和 `passed` 的口径不同（不可判定不等于通过），刻意分开 ——
 * 退出码要用于 CI 分流，把「没跑上验证手段」当成失败会让这个开关对非代码任务失效。
 */
export function isRunSuccessful(
  state: AgentRunState,
  verification: TaskVerificationResult | undefined,
): boolean {
  if (state.stopReason?.type !== 'task_completed') return false;
  if (verification?.verificationStatus !== 'executed') return true;
  return verification.passed;
}

/**
 * 一次性运行的机器可读结果（`--output-format json` 的那一行）。
 *
 * 字段与 state 同构，只加三样 state 里没有的：`ok`（这次成没成）、`task`（跑的是什么）
 * 与 `answer`（模型的收尾发言）。同构是有意的 —— CI 里比对的就是 trace 里那套口径，
 * 换个名字就得维护一张对照表。
 */
export function buildHeadlessResult(input: {
  task: string;
  sessionId: string;
  state: AgentRunState;
  verification: TaskVerificationResult | undefined;
  answer: string | undefined;
  persistence: { degraded: boolean; error: string | null };
}): Record<string, unknown> {
  const { task, sessionId, state, verification, answer, persistence } = input;

  return {
    task,
    sessionId,
    ok: isRunSuccessful(state, verification),
    stopReason: state.stopReason ?? null,
    decisions: state.decisions.length,
    toolCalls: state.toolCallCount,
    tokenUsage: state.tokenUsage,
    contextSize: state.contextSize,
    approvals: state.approvals,
    verification: verification ?? null,
    answer: answer ?? null,
    persistence,
  };
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


/**
 * `/session` 的子命令：`rm <id>` 删除、`export <id> [文件]` 导出 trace。
 *
 * 返回文本而不是直接打印：这样它可以被单测覆盖（`main()` 里的东西测不到），
 * 也与命令表的分工一致 —— 命令只负责把文本交给 host。
 *
 * 两条与「不可逆」有关的规矩：
 *   - **不删当前会话**：正在写的那个会话被删掉之后，接下来每一条事件都会静默失败，
 *     而用户看到的只是「这一轮怎么没记下来」；
 *   - 删除只影响会话（一段对话），不动工作区里的任何文件 —— 这两件事名字像，
 *     后果完全不同，回话里必须说清。
 */
export function runSessionCommand(input: {
  workspacePath: string;
  /** 当前会话 id：删它会被拒绝 */
  currentSessionId: string;
  arg: string;
}): { text: string } {
  const { workspacePath, currentSessionId, arg } = input;
  const [verb, ...rest] = arg.trim().split(/\s+/);
  const target = rest[0] ?? '';

  if (verb === 'rm' || verb === 'delete') {
    if (target === '') {
      return { text: `用法：/session rm <会话ID>（用 /session 看有哪些）` };
    }
    if (target === currentSessionId) {
      return {
        text: `✗ ${target} 是当前会话，不能删。\n` +
          `  换一个工作区或先 /quit，再用 --list 找到它删掉：会话是正在写的那个文件。`,
      };
    }

    const result = deleteSession(workspacePath, target);
    if (!result.deleted) {
      return { text: `✗ 没删成：${result.reason}。工作区里的文件一个都没动。` };
    }
    return { text: `✓ 已删除会话 ${target}（只删了这段对话的记录，工作区里的文件没动）` };
  }

  if (verb === 'export') {
    if (target === '') {
      return { text: `用法：/session export <会话ID> [文件名]（不给文件名就打印出来）` };
    }

    const store = new SessionStore(workspacePath, target);
    const events = store.readEvents();
    if (events.length === 0) {
      return { text: `✗ 读不到会话 ${target} 的任何事件（ID 是否写对？用 /session 看清单）` };
    }

    const markdown = renderSessionMarkdown(events);
    const file = rest[1];
    if (file === undefined) return { text: markdown };

    // 相对路径按当前工作区算：与用户敲命令时的心智一致（工具也都按工作区解析）
    const outPath = isAbsolute(file) ? file : join(workspacePath, file);
    try {
      writeFileSync(outPath, markdown, 'utf8');
    } catch (error) {
      return { text: `✗ 写入失败：${(error as Error).message}` };
    }
    return { text: `✓ 已导出 ${events.length} 条事件到 ${outPath}` };
  }

  return {
    text: `用法：/session [rm <会话ID> | export <会话ID> [文件名]]\n` +
      `  /session             列出当前工作区的会话\n` +
      `  /session export <ID> 导出一份人读的 trace（Markdown）`,
  };
}

/**
 * `/mcp` 的正文：已连接的 server 与它们的工具、没连上的原因、配置文件在哪。
 *
 * 三种状态都说清楚位置和形状，因为敲 /mcp 的人通常就是想配一个服务：
 * 只回一句「没有 MCP 服务」，他还得回来问你文件该叫什么、放哪儿。
 */
export function formatMcpStatus(input: {
  config: McpConfigLoad;
  connections: readonly McpConnectedServer[];
  failures: readonly { server: string; message: string }[];
}): string {
  const { config: loaded, connections, failures } = input;
  const lines: string[] = [];

  if (loaded.error !== null) {
    lines.push(chalk.red(`✗ ${loaded.error}`));
    lines.push(chalk.dim(`配置文件：${loaded.file}`));
    lines.push(chalk.dim('改好之后重启 acode 生效：MCP 只在启动时连接一次。'));
    return lines.join('\n');
  }

  if (connections.length === 0) {
    lines.push(chalk.dim('还没有连接任何 MCP 服务。'));
  } else {
    lines.push(`已连接 ${connections.length} 个 MCP 服务：`);
    for (const connection of connections) {
      lines.push(`  ${chalk.green('✓')} ${chalk.cyan(connection.server)} ${chalk.dim(`（${connection.tools.length} 个工具）`)}`);
      for (const tool of connection.tools) {
        // 工具名是模型要调用的那个（已命名空间化），描述只取首行——列表里塞整段会看不出结构
        const summary = tool.description.split('\n')[0]?.trim() ?? '';
        lines.push(chalk.dim(`    ${tool.name}${summary === '' ? '' : `  ${summary}`}`));
      }
    }
  }

  for (const failure of failures) {
    lines.push(chalk.yellow(`  ! ${failure.server} 连接失败：${failure.message}`));
  }

  lines.push(chalk.dim(`配置文件：${loaded.file}`));
  if (connections.length === 0) {
    lines.push(chalk.dim(`形状（新增后重启 acode 生效）：\n${MCP_CONFIG_EXAMPLE}`));
  }

  return lines.join('\n');
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
  // 可变的：MCP 的远程工具在下面追加进来（createDefault 得到的那批保持原样，
  // 顺序也不动 —— 工具顺序会随请求下发，插在中间会让提示前缀白变一次）
  let tools = registry.getAllTools();

  let shuttingDown = false;

  // 交互式下不建 readline 实例：它一建起来就把 stdin 的按键整个接管，
  // 会和自带候选菜单的输入组件抢同一份按键。只有非交互（管道、脚本）才需要它 ——
  // 那里没有按键事件，也没有列宽，谈不上菜单。
  const interactive = stdin.isTTY === true && stdout.isTTY === true;
  const pipeTerminal = interactive
    ? null
    : createInterface({ input: stdin, output: stdout, terminal: true });

  /**
   * 管道输入的排队区。
   *
   * readline 一建起来就开始读，而它只把行交给「提问时登记的那个回调」：
   * 早于第一次提问到达的行以 'line' 事件发出去，那时还没有人接，就没了 ——
   * `printf '/mcp\n' | acode` 于是表现成「敲的命令被吃掉」。启动要连 MCP
   * （几百毫秒）之后这个窗口必然存在，所以这里自己收着：先到的排队，
   * 提问时先从队里取，取空了才等下一行。
   */
  const pipedLines: string[] = [];
  let awaitingLine: (() => void) | null = null;
  let pipedClosed = false;

  if (pipeTerminal !== null) {
    const piped = pipeTerminal;

    piped.on('SIGINT', () => {
      shuttingDown = true;
      piped.close();
    });

    // 一律先入队再唤醒等待者：醒来时「队列空」于是只可能有一个含义 —— 管道关掉了
    piped.on('line', (line) => {
      pipedLines.push(line);
      const awaiting = awaitingLine;
      if (awaiting !== null) {
        awaitingLine = null;
        awaiting();
      }
    });

    /**
     * 管道读完 = 不会再有下一行。
     *
     * 原来这里什么都不做，于是下一次提问会撞上「readline 已关闭」并把它当异常抛出：
     * 命令明明都跑完了，进程却带一个错误信息以退出码 1 收场。这里只唤醒等待者，
     * 由 askUser 按「用户不再输入」处理（与 Ctrl+C 同一条路：干净退出）。
     */
    piped.on('close', () => {
      pipedClosed = true;
      const awaiting = awaitingLine;
      if (awaiting !== null) {
        awaitingLine = null;
        awaiting();
      }
    });
  }

  /**
   * 读一行输入。
   *
   * 审批问答不传 commands，于是那条路上没有菜单 —— 它不需要命令表。
   * Ctrl+C 在这里表现为 InputAborted，由调用方决定是退出会话还是中止这一轮。
   */
  async function askUser(prompt: string, commands?: readonly SlashCommand[]): Promise<string> {
    if (pipeTerminal !== null) {
      // question() 会自己打提示符；自己收输入就得自己打，否则管道下的记录少一段
      process.stdout.write(prompt);

      const queued = pipedLines.shift();
      if (queued !== undefined) return queued;
      // 队列已空且管道读完：不会再有下一行，按「输入结束」收场（输入结束 ≠ 敲了回车）
      if (pipedClosed) throw new InputAborted();

      await new Promise<void>((resolve) => {
        awaitingLine = resolve;
      });

      // 被 'line' 唤醒时队列必然非空；队列空只可能是被 'close' 唤醒
      const next = pipedLines.shift();
      if (next !== undefined) return next;
      throw new InputAborted();
    }

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
    sessionAdmin: (arg) => runSessionCommand({
      workspacePath: sessionWorkspace,
      currentSessionId: session.sessionId,
      arg,
    }).text,
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

    // mcp / mcpConfig 都在下面才连上：这个闭包只会在交互循环里被调用（那时早已就绪），
    // 所以这里引用后声明的 const 是安全的，不必为了「定义顺序」把连接提前到 host 之前
    mcpStatus: () => formatMcpStatus({
      config: mcpConfig,
      connections: mcp.connections,
      failures: mcp.failures,
    }),

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



  // 结构化输出（--output-format json / stream-json）下 stdout 只承载机器可读的内容：
  // 混进一块人读的面板，调用方就得先学会怎么把它剔掉。
  const quiet = args.outputFormat !== 'text';

  if (!quiet) {
    // 工作区指令会进系统提示：不在这里说一声，用户只能靠模型的表现猜它读到了什么
    const instructions = loadProjectInstructions(host.state.workspace);

    console.log(panel('会话', [
      ['工作区', host.state.workspace],
      ['会话', `${session.sessionId}  ${chalk.dim(sessionNote)}`],
      ['模型', `${host.state.model}  ${chalk.dim(`· 迭代上限 ${args.maxIterations} 轮`)}`],
      ...(instructions !== null
        ? [['指令', `${instructions.file}  ${chalk.dim(`· ${formatCount(instructions.content.length)} 字符${instructions.truncated ? '（已截断）' : ''}`)}`] as const]
        : []),
    ]));
    console.log(chalk.dim('输入 /help 看命令，/quit 退出；行首敲 / 会列出候选'));
    if (args.dev) console.log(chalk.dim('dev 参数:'), args);
    console.log('');
  }

  // ---- MCP：连上工作区配置里的外部 server，把它们的工具并进工具表 ----
  //
  // 只在启动时读一次配置、连一次：工具声明会进首轮请求的前缀，会话中途增删会让整段
  // 前缀缓存失效。代价是 /cd 换工作区之后 MCP 工具不变（/mcp 里也照实说）。
  // 收尾句柄先声明后赋值：连接这一步若真出了问题（配置读取抛错、回调实现有 bug），
  // finally 里的 `mcp` 还停在 TDZ，会在那里再抛一个 ReferenceError —— 把真正的原因盖掉。
  let closeMcp: (() => Promise<void>) | null = null;

  const mcpConfig = loadMcpConfig(host.state.workspace);
  const mcp = await connectMcpServers(mcpConfig.servers, {
    // server 的日志一律走 stderr：headless（--output-format json）下 stdout 只能有 JSON。
    // 结构化输出下索性不打，否则 CI 日志里会混进外部服务的噪音。
    onLog: (server, line) => {
      if (!quiet) console.error(chalk.dim(`[mcp:${server}] ${line}`));
    },
    // 连接失败只警告不阻断：某个 server 配错（命令写错、依赖没装）不该让 CLI 用不了。
    // 这条走 stderr 且不随 quiet 关闭 —— 它是失败，不是进度信息。
    onError: (server, message) => {
      console.error(chalk.yellow(`! MCP ${server}：${message}`));
    },
  });
  closeMcp = () => mcp.close();
  tools = [...tools, ...mcp.tools];

  /**
   * 常驻白名单：哪些工具的 schema 随首轮请求下发。
   *
   * 远程工具强制常驻 —— 用户连 MCP 就是为了让模型用上它，而被延迟的工具模型得先
   * tool_search 才知道它存在。这么做不违反「声明集恒定」：这份列表在首轮请求之前
   * 就定死了，整个会话都不再变（MCP 只在启动时连一次）。
   */
  const eagerToolNames = mcp.tools.length === 0
    ? config.tools.eager
    : [...config.tools.eager, ...mcp.tools.map((tool) => tool.name)];

  if (!quiet) {
    for (const connection of mcp.connections) {
      console.log(chalk.dim(
        `  · MCP ${connection.server} 已连接（${connection.tools.length} 个工具，敲 /mcp 看清单）`,
      ));
    }
  }

  /** 每轮一个全新的 runtime：state 不跨轮复用，历史靠 history 传递 */
  async function runOne(task: string): Promise<{ state: AgentRunState; verification: TaskVerificationResult | undefined; answer: string | undefined }> {
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
    /**
     * 这一轮里发生过几次「上下文折叠」。
     *
     * 不落盘也要说一声：折叠之后模型会「忘了」早先读到的内容，用户看到它重新读一遍
     * 同一个文件时，得能知道那是设计使然，而不是模型开始胡来（见 context-fold）。
     */
    let foldCount = 0;

    const ensureNewline = (): void => {
      if (atLineStart) return;
      // 换两行
      process.stdout.write('\n\n');
      atLineStart = true;
    };

    const runtime = new AgentRuntime(provider, tools, {
      workspacePath: host.state.workspace,
      maxIterations: args.maxIterations,
      // 只有显式给了上限才传：undefined 与 0 都表示「不限制」
      ...(args.maxTokens !== undefined ? { maxTokens: args.maxTokens } : {}),
      eagerTools: eagerToolNames,
      priorRuns: history,
      onStreamDelta: (delta) => {
        // 思考链 本轮不渲染：deepseek-chat 不返回它，等切到 thinking 模型再给它一块区域
        const text = delta.content;
        if (!text) return;
        if (quiet) return; // 结构化输出下正文只出现在结果 JSON 的 answer 里
        process.stdout.write(text);
        atLineStart = text.endsWith('\n');
        roundStreamedText = true;
      },

      // 事件逐条落盘；顺带把工具调用打给用户看，否则一轮跑几分钟是静默的
      onSessionEvent: (event: SessionEventInput) => {
        session.append(event);

        // stream-json：事件原样逐行吐给调用方（这就是「事件流」这一形态的全部内容）
        if (args.outputFormat === 'stream-json') {
          console.log(JSON.stringify({ type: event.type, payload: event.payload }));
          return;
        }
        if (quiet) return;

        if (event.type === 'context_folded') {
            foldCount += 1;
        }

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
          // 被输出预算截断时说一声：用户看到的量与实际送进模型的量差很多，
          // 不说就会以为模型看到的也是这么点（见 ObservationDelivery）
          const trimmed = observation.delivery?.truncated
            ? chalk.dim(` （原文 ${formatCount(observation.delivery.rawChars)} 字符，实际送出 ${formatCount(observation.delivery.deliveredChars)}）`)
            : '';
          console.log(`  ${chalk.dim('·')} ${chalk.cyan(label)} ${mark}${trimmed}`);
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
      // 审批：--yes 一律放行（无人值守的前提就是「别问了」）；结构化输出下索性不注入
      // 回调 —— 运行时据默认策略（auto-reject）拒绝需要审批的动作并留下审计记录。
      // CI 里卡在 y/N 上比被拒更糟，而被拒至少是能看见、能解释的。
      ...(args.yes ? { approvalPolicy: 'auto-approve' as const } : {}),
      ...(quiet || args.yes ? {} : {
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
      }),
    });

    const result = await runtime.run(task);

    const last = result.state.decisions[result.state.decisions.length - 1];
    const answer = last?.type === 'Final' ? last.answer : undefined;

    const persistence = runtime.getPersistenceStatus();

    if (quiet) {
      // 结构化输出：一行结果，不掺别的东西。stream-json 也用这一行收尾，
      // 用 `type: 'run_result'` 与前面的事件行区分开。
      const outcome = buildHeadlessResult({
        task,
        sessionId: session.sessionId,
        state: result.state,
        verification: result.verification,
        answer,
        persistence,
      });
      console.log(JSON.stringify(
        args.outputFormat === 'stream-json' ? { type: 'run_result', ...outcome } : outcome,
      ));

      // 这一轮照样成为下一轮的历史（--task 下没有下一轮，但这是同一套路径）
      history.push(priorRunOf(result.state, task));
      return { state: result.state, verification: result.verification, answer };
    }

    if (answer !== undefined) {
      // 已经流出来的正文不再打第二遍。只有这一轮什么都没流出来时才补打 ——
      // 例如流式被关掉，或模型这一轮确实没产出正文（此时 answer 是兜底文案）。
      if (roundStreamedText) {
        ensureNewline();
      } else {
        console.log('');
        console.log(answer);
      }
    }

    const { tokenUsage: usage, contextSize } = result.state;
    const stop = describeStopReason(result.state.stopReason);
    const cache = describeCacheUsage(usage);
    const verification = describeVerification(result.verification);

    ensureNewline();

    console.log('');
    console.log(panel('本轮结果', [
      ['停止', marked(stop.tone, stop.text)],
      // 验收紧跟在停止原因之后：这两个结论一起回答「这一轮到底成了没有」
      ...(verification !== null ? [['验收', paint(verification.tone, verification.text)] as const] : []),
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

    // 折叠的告知：模型接下来可能重读早先读过的文件，这属于预期行为，不是它糊涂了
    if (foldCount > 0) {
      console.log(chalk.dim(`  · 上下文超预算，本轮折叠较早的历史 ${foldCount} 次（文件/决策照常落盘，模型需要时会重读）`));
    }

    // 审批的审计：谁批准/拒绝了什么。原来是只留一行 warn，事后无从查起
    const approvals = result.state.approvals;
    if (approvals.length > 0) {
      const approved = approvals.filter((record) => record.decision === 'approve').length;
      console.log(chalk.dim(`  · 审批 ${approvals.length} 次（批准 ${approved} / 拒绝 ${approvals.length - approved}）`));
      for (const record of approvals) {
        const mark = record.decision === 'approve' ? chalk.green('✓') : chalk.red('✗');
        console.log(chalk.dim(`    ${mark} [${record.source}] ${record.summary}`));
      }
    }

    if (persistence.degraded) {
      console.log(chalk.red(`  ✗ 持久化降级：${persistence.error}`));
    }

    // 这一轮成为下一轮的历史
    history.push(priorRunOf(result.state, task));

    return { state: result.state, verification: result.verification, answer };
  }

  try {
    // 一次性模式：跑完就走，适合脚本里调
    if (args.task !== undefined) {
      const outcome = await runOne(args.task);
      // 退出码是 headless 形态的一半：CI 拿不到结构化产物时，至少能用它分流。
      // 只在一次性模式设 —— 交互式会话里某一轮失败不该决定整个进程的结局。
      process.exitCode = isRunSuccessful(outcome.state, outcome.verification) ? 0 : 1;
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

      // 光一个 `/` 既不是命令也不是任务：Esc 收起候选菜单后回车，交回来的就是它。
      // 送给模型只会换来一句关于斜杠的胡话，而且照样计费。
      if (line === '/') {
        console.log(chalk.dim('单独一个 / 不构成命令：接着敲命令名，或用 ↑↓ 选择后再回车'));
        continue;
      }

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
    // MCP 子进程必须在这里收掉，三条退出路径（交互结束、--task 跑完、抛异常）都经过
    // 这个 finally：不收，管道的句柄会让事件循环一直活着 —— 表现为「/quit 敲了但命令行
    // 不回来」，而子进程还会留在进程表里。
    await closeMcp?.();
    // 结构化输出的 stdout 只能有 JSON：把「接着聊」这类人读内容挡在外面，
    // 否则调用方拿到的每一行都得先判一次是不是 JSON（--task 下这个 finally 照跑）。
    if (!quiet) {
      console.log('');
      console.log(`${chalk.dim('会话')} ${chalk.cyan(session.sessionId)}`);
      console.log(
        chalk.dim('接着聊：') +
        chalk.cyan(`acode --resume=${session.sessionId}`),
      );
    }
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
