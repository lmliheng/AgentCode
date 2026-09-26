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
  placeholder('auth', '配置 API Key'),
  placeholder('cd', '切换工作区'),
  {
    name: 'help',
    description: '打印用法与命令表',
    takesArg: false,
    run: (_arg, host) => host.print(host.usage()),
  },
  placeholder('mcp', '管理 MCP 服务'),
  placeholder('model', '切换模型'),
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
