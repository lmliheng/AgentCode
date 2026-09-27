// src/utils/slash-commands.ts
//
// 行首 `/` 命令表，以及围绕它的两个纯函数：候选匹配与候选渲染。
//
// 这里只有数据和纯逻辑，不碰终端：命令自己要打印什么，通过 SlashCommandHost 注入，
// 于是命令表可以在没有 TTY 的测试里整张跑一遍。
//
// 命令表是**唯一事实源**：候选菜单、实际派发、/help 的正文都从它生成。
// 加一个命令只改这一处，不会出现「帮助里写了一个不存在的命令」这种漂移。

import chalk from 'chalk';

import { displayWidth, truncateToWidth } from './terminal-width.js';

/** 会话内可变的配置项。改它们只影响后续任务，不动已落盘的历史 */
export interface SessionSettings {
  model: string;
  workspace: string;
}

export type WorkspaceSwitchResult =
  | { ok: true; path: string }
  | { ok: false; reason: string };

export type SaveResult = { ok: true } | { ok: false; reason: string };

/**
 * 命令执行时能拿到的外部能力。
 *
 * 全部注入而不是直接 import：命令表因此不依赖会话存储、不依赖 stdout，
 * 测试里换成收集数组就能断言每个命令打印了什么。
 */
export interface SlashCommandHost {
  /** 输出一行 */
  print: (text: string) => void;
  /** 请求退出会话 */
  exit: () => void;
  /** 列出本工作区会话的现成文本 */
  sessions: () => string;
  /** 完整用法（含本命令表） */
  usage: () => string;

  /**
   * 会话内可变的配置。
   *
   * 两项都是「本进程的意图」，不是运行状态：它们不进事件流，也不跨 `--resume`
   * 恢复（模型名与工作区本来就由命令行参数给出）。所以直给一个可变对象，
   * 不给每项配一对 getter/setter。
   */
  readonly state: SessionSettings;

  /** 切换工作区：成功给出规范化后的路径，失败给出原因（不抛错） */
  switchWorkspace: (path: string) => WorkspaceSwitchResult;

  /** API Key 的现状（来源 + 配置位置），供 /auth 报告 */
  apiKeyStatus: () => string;
  /** 保存 API Key；失败时给出原因而不是抛错 */
  saveApiKey: (key: string) => SaveResult;

  /** 读一个不回显的值（API Key 之类） */
  askSecret: (prompt: string) => Promise<string>;
}

export interface SlashCommand {
  /** 不带 `/` 前缀 */
  name: string;
  description: string;
  /**
   * 是否接参数。只影响 Tab 补全的形状：接参数的补成 `/name `（留尾空格继续敲），
   * 不接参数的补成 `/name`。菜单的开关不看它 —— 那里只看行里有没有空格。
   */
  takesArg: boolean;
  run: (arg: string, host: SlashCommandHost) => void | Promise<void>;
}

/** 还没接上实现的命令：注册进表、给描述、敲了说明白，不要静默什么都不做 */
function placeholder(name: string, purpose: string): SlashCommand {
  return {
    name,
    description: `${purpose}（尚未接入）`,
    takesArg: true,
    run: (_arg, host) => host.print(chalk.yellow(`  ! /${name} 尚未接入：${purpose}`)),
  };
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    name: 'auth',
    description: '配置 API Key（写入用户级 .env）',
    // 先问再答：交互式读密钥，所以不带参数，补全时也不会留出尾空格
    takesArg: false,
    run: async (arg, host) => {
      // 写成参数就会留在屏幕上（还会进终端回滚缓冲），所以这里直接挡下来，
      // 而不是默默忽略 —— 用户很可能以为已经存进去了
      if (arg.trim() !== '') {
        host.print(chalk.yellow('  ! 不要把 Key 写在命令里：那样它会留在屏幕上。'));
        host.print(chalk.dim('敲 /auth 后按提示输入，那里不回显'));
        return;
      }

      host.print(host.apiKeyStatus());

      // 掩码输入：密钥不能留在屏幕上，也不能进终端的回滚缓冲
      const key = (await host.askSecret('新的 DEEPSEEK_API_KEY（直接回车取消）: ')).trim();
      if (key === '') {
        host.print(chalk.dim('已取消，Key 未改动'));
        return;
      }

      const saved = host.saveApiKey(key);
      host.print(
        saved.ok
          ? chalk.green('✓ API Key 已保存并生效')
          : chalk.red(`✗ 保存失败：${saved.reason}`),
      );
    },
  },
  {
    name: 'cd',
    description: '切换工作区（会话归属不变）',
    takesArg: true,
    run: (arg, host) => {
      const target = arg.trim();
      if (target === '') {
        host.print(chalk.dim(`当前工作区 ${host.state.workspace}`));
        host.print(chalk.dim('用法：/cd <目录>'));
        return;
      }

      const switched = host.switchWorkspace(target);
      if (!switched.ok) {
        host.print(chalk.red(`✗ 切换失败：${switched.reason}`));
        return;
      }

      host.state.workspace = switched.path;
      host.print(chalk.green(`✓ 后续任务的工作区：${switched.path}`));
      // 会话的分区在创建时就定死了，换工作区不会把历史搬过去 —— 这一点必须说出来
      host.print(chalk.dim('会话仍属于启动时的工作区：/session 与 --resume 都按它找'));
    },
  },
  {
    name: 'help',
    description: '打印用法与命令表',
    takesArg: false,
    run: (_arg, host) => host.print(host.usage()),
  },
  placeholder('mcp', '管理 MCP 服务'),
  {
    name: 'model',
    description: '切换模型',
    takesArg: true,
    run: (arg, host) => {
      const name = arg.trim();
      if (name === '') {
        host.print(chalk.dim(`当前模型 ${host.state.model}`));
        host.print(chalk.dim('用法：/model <名称>，下一轮任务起生效'));
        return;
      }

      host.state.model = name;
      host.print(chalk.green(`✓ 模型已切换为 ${name}`) + chalk.dim('（下一轮任务起生效）'));
    },
  },
  {
    name: 'quit',
    description: '退出会话',
    takesArg: false,
    run: (_arg, host) => host.exit(),
  },
  {
    name: 'session',
    description: '列出本工作区的会话',
    takesArg: false,
    run: (_arg, host) => host.print(host.sessions()),
  },
];

/**
 * 这一行要不要出候选菜单；要的话，用哪个前缀去匹配。
 *
 * 返回 null = 菜单不该出现。只有「`/` 在行首、且后面还没有空格」才出菜单：
 * 一旦开始敲参数（`/model deepseek`），菜单就让位给正常的输入。
 * 反过来说，参数删掉退回 `/model` 时菜单会自动回来 —— 不需要额外的模式标记。
 */
export function commandQuery(line: string): string | null {
  if (!line.startsWith('/')) return null;

  const name = line.slice(1);
  if (/\s/.test(name)) return null;

  return name;
}

/** 按前缀匹配命令名。空 query（只敲了一个 `/`）返回全部 */
export function matchCommands(
  commands: readonly SlashCommand[],
  query: string,
): SlashCommand[] {
  const lowered = query.toLowerCase();
  return commands.filter((command) => command.name.toLowerCase().startsWith(lowered));
}

/**
 * 菜单当前高亮的那一项；菜单收起（Esc）或没有候选时为空。
 *
 * Enter 与 Tab 都走这里：`▸` 指着哪一条，两个键就取哪一条。屏幕上的高亮是一句
 * 承诺 —— 它指着 `/cd` 而回车却交出 `/`，用户看到的就是「下拉框选不中」。
 * 只敲了一个 `/` 时高亮落在第一条命令上，也照取，不做特例（Tab 本来就是这么做的）。
 */
export function selectedCommand(
  matches: readonly SlashCommand[],
  selected: number,
  dismissed: boolean,
): SlashCommand | undefined {
  return dismissed ? undefined : matches[selected];
}

export interface ParsedCommand {
  command: SlashCommand;
  /** 命令名之后的部分，去掉两端空白 */
  arg: string;
}

/**
 * 把一行解析成命令，解析不出命令返回 null。
 *
 * **只有命令名在表里才算命令**。这条规则不为省事：一个以 `/` 开头的绝对路径
 * （`/tmp/x 里有什么`）拿掉首字符后名字是 `tmp`，不在表里，于是它照常作为任务
 * 送给模型；反之若「以 / 开头就当命令」，这类任务会被静默吃掉。
 * 代价是 `/heelp` 这种拼错的名字会被当成任务送去模型，而不是报未知命令。
 */
export function parseCommand(
  commands: readonly SlashCommand[],
  line: string,
): ParsedCommand | null {
  if (!line.startsWith('/')) return null;

  const rest = line.slice(1);
  const boundary = rest.search(/\s/);
  const name = boundary === -1 ? rest : rest.slice(0, boundary);
  const arg = boundary === -1 ? '' : rest.slice(boundary + 1).trim();

  const command = commands.find((candidate) => candidate.name === name);
  return command === undefined ? null : { command, arg };
}

/**
 * 候选菜单的每一行。
 *
 * 保证「一个候选 = 一行」：描述按剩余列宽截断。终端自动折行会让「这一帧占几行」
 * 的账算错，重绘时盖错位置，所以宁可截断。
 */
export function renderSuggestionList(
  commands: readonly SlashCommand[],
  selected: number,
  width: number,
): string[] {
  if (commands.length === 0) return [];

  const nameWidth = commands.reduce(
    (max, command) => Math.max(max, displayWidth(`/${command.name}`)),
    0,
  );

  return commands.map((command, index) => {
    const glyph = index === selected ? '▸ ' : '  ';
    const name = `/${command.name}`;
    const gap = ' '.repeat(nameWidth - displayWidth(name) + 2);

    const prefix = `${glyph}${name}${gap}`;
    const description = truncateToWidth(command.description, Math.max(0, width - displayWidth(prefix)));

    if (index === selected) return chalk.inverse(prefix + description);
    return chalk.cyan(glyph + name) + gap + chalk.dim(description);
  });
}

/** /help 与 --help 共用的命令表正文 */
export function renderCommandHelp(commands: readonly SlashCommand[]): string {
  const nameWidth = commands.reduce(
    (max, command) => Math.max(max, displayWidth(`/${command.name}`)),
    0,
  );

  const rows = commands.map((command) => {
    const name = `/${command.name}`;
    return `  ${name}${' '.repeat(nameWidth - displayWidth(name))}  ${command.description}`;
  });

  return ['交互命令（行首输入 / 列出候选，↑↓ 选择，Tab 补全）:', ...rows].join('\n');
}
