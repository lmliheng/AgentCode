// src/test/cli/slash-commands.test.ts
//
// 覆盖行首 `/` 命令表：匹配、派发、候选菜单排版、帮助正文。
//
// 命令表是候选菜单、实际派发、/help 三处的唯一来源，所以这里既测「敲什么触发什么」，
// 也测「表里每条命令都真有实现或明说没实现」—— 后者是这张表最容易悄悄退化的地方。

import { describe, it, expect } from 'vitest';

import {
  SLASH_COMMANDS,
  commandQuery,
  matchCommands,
  parseCommand,
  renderCommandHelp,
  renderSuggestionList,
} from '../../utils/slash-commands.js';

import { displayWidth } from '../../utils/terminal-width.js';

import type { SlashCommandHost } from '../../utils/slash-commands.js';

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
const plain = (text: string): string => text.replace(ANSI_PATTERN, '');

/** 把命令要用的外部能力换成收集器，于是整张命令表可以离开 TTY 跑一遍 */
function recorder(): {
  host: SlashCommandHost;
  printed: string[];
  exited: () => boolean;
} {
  const printed: string[] = [];
  let didExit = false;

  return {
    printed,
    exited: () => didExit,
    host: {
      print: (text) => {
        printed.push(text);
      },
      exit: () => {
        didExit = true;
      },
      sessions: () => '（会话列表）',
      usage: () => '（用法）',
    },
  };
}

describe('命令表本身', () => {
  it('命令名不重复，且每条都写了描述', () => {
    const names = SLASH_COMMANDS.map((command) => command.name);

    expect(new Set(names).size).toBe(names.length);
    for (const command of SLASH_COMMANDS) {
      expect(command.description.trim()).not.toBe('');
    }
  });

  it('每条命令都有去处：真实现或明说尚未接入，不许静默无反应', async () => {
    for (const command of SLASH_COMMANDS) {
      const { host, printed, exited } = recorder();
      await command.run('', host);

      const reacted = exited() || printed.join('\n').trim() !== '';
      expect(reacted).toBe(true);
    }
  });

  it('/help 打印调用方给的用法正文', async () => {
    const { host, printed } = recorder();
    await parseCommand(SLASH_COMMANDS, '/help')!.command.run('', host);

    expect(printed.join('\n')).toContain('（用法）');
  });

  it('/session 打印调用方给的会话列表', async () => {
    const { host, printed } = recorder();
    await parseCommand(SLASH_COMMANDS, '/session')!.command.run('', host);

    expect(printed.join('\n')).toContain('（会话列表）');
  });

  it('/quit 只发出退出信号，自己不打印东西', async () => {
    const { host, printed, exited } = recorder();
    await parseCommand(SLASH_COMMANDS, '/quit')!.command.run('', host);

    expect(exited()).toBe(true);
    expect(printed).toEqual([]);
  });

  it('尚未接入的命令敲了会说清楚，不装作执行了', async () => {
    const { host, printed } = recorder();
    await parseCommand(SLASH_COMMANDS, '/model deepseek-chat')!.command.run('', host);

    expect(printed.join('\n')).toContain('尚未接入');
  });
});

describe('什么时候该出候选菜单', () => {
  it('行首一个 / 就是全部候选', () => {
    expect(commandQuery('/')).toBe('');
  });

  it('继续敲命令名时前缀跟着走', () => {
    expect(commandQuery('/mod')).toBe('mod');
    expect(commandQuery('/model')).toBe('model');
  });

  it('一旦开始敲参数就让位给正常输入', () => {
    // 菜单关掉是「行里出现了空格」这一个条件，所以参数删回去时它会自己回来
    expect(commandQuery('/model deepseek-chat')).toBeNull();
    expect(commandQuery('/model ')).toBeNull();
  });

  it('必须顶在行首，且不是普通任务', () => {
    expect(commandQuery('  /help')).toBeNull();
    expect(commandQuery('帮我看下代码')).toBeNull();
    expect(commandQuery('')).toBeNull();
  });
});

describe('候选匹配', () => {
  it('空前缀给全部命令', () => {
    expect(matchCommands(SLASH_COMMANDS, '')).toHaveLength(SLASH_COMMANDS.length);
  });

  it('按前缀过滤，且不区分大小写', () => {
    expect(matchCommands(SLASH_COMMANDS, 'm').map((command) => command.name))
      .toEqual(['mcp', 'model']);
    expect(matchCommands(SLASH_COMMANDS, 'MOD').map((command) => command.name))
      .toEqual(['model']);
  });

  it('匹配不上时返回空数组，菜单据此收起', () => {
    expect(matchCommands(SLASH_COMMANDS, 'zz')).toEqual([]);
  });
});

describe('把一行解析成命令', () => {
  it('命令名后面的部分作为参数，去掉两端空白', () => {
    const parsed = parseCommand(SLASH_COMMANDS, '/model  deepseek-chat ');

    expect(parsed?.command.name).toBe('model');
    expect(parsed?.arg).toBe('deepseek-chat');
  });

  it('不带参数的写法参数为空串', () => {
    expect(parseCommand(SLASH_COMMANDS, '/quit')?.arg).toBe('');
  });

  it('名字不在表里就不算命令', () => {
    // 这条规则是为了不把以 / 开头的绝对路径当成命令吃掉：它要照常作为任务送给模型
    expect(parseCommand(SLASH_COMMANDS, '/tmp/x 里有什么')).toBeNull();
    expect(parseCommand(SLASH_COMMANDS, '/heelp')).toBeNull();
  });

  it('不以 / 开头的行不是命令', () => {
    expect(parseCommand(SLASH_COMMANDS, 'quit')).toBeNull();
    expect(parseCommand(SLASH_COMMANDS, '')).toBeNull();
  });

  it('命令名大小写敏感：菜单能补全它，但直接敲不认', () => {
    expect(parseCommand(SLASH_COMMANDS, '/QUIT')).toBeNull();
  });
});

describe('候选菜单的排版', () => {
  const width = 40;

  it('一个候选正好占一行：描述被截断而不是撑出宽度', () => {
    const rows = renderSuggestionList(SLASH_COMMANDS, 0, width);

    expect(rows).toHaveLength(SLASH_COMMANDS.length);
    for (const row of rows) {
      expect(displayWidth(row)).toBeLessThanOrEqual(width);
    }
  });

  it('窄一点的终端下仍然一个候选一行', () => {
    const rows = renderSuggestionList(SLASH_COMMANDS, 0, 20);

    expect(rows).toHaveLength(SLASH_COMMANDS.length);
    for (const row of rows) {
      expect(displayWidth(row)).toBeLessThanOrEqual(20);
    }
  });

  it('选中的那一行与其它行不同，且带选中标记', () => {
    const rows = renderSuggestionList(SLASH_COMMANDS, 0, width);

    expect(rows[0]).not.toBe(rows[1]);
    expect(plain(rows[0]!)).toContain('▸');
    expect(plain(rows[1]!)).not.toContain('▸');
  });

  it('每行都带上自己的命令名', () => {
    const rows = renderSuggestionList(SLASH_COMMANDS, 0, width).map(plain);

    SLASH_COMMANDS.forEach((command, index) => {
      expect(rows[index]).toContain(`/${command.name}`);
    });
  });

  it('没有候选时不产出任何行', () => {
    expect(renderSuggestionList([], 0, width)).toEqual([]);
  });
});

describe('帮助正文与命令表同源', () => {
  it('表里每个命令都出现在帮助里', () => {
    const help = renderCommandHelp(SLASH_COMMANDS);

    for (const command of SLASH_COMMANDS) {
      expect(help).toContain(`/${command.name}`);
    }
  });

  it('命令名按显示列对齐，取值从同一列开始', () => {
    const rows = renderCommandHelp(SLASH_COMMANDS).split('\n').slice(1);

    // 每行是「两空格 + 命令名 + 补白 + 两空格 + 描述」，描述前的整段就是列位置
    const descriptionColumn = (row: string): number => {
      const separator = /\s{2,}/.exec(row.slice(2));
      const end = separator === null ? row.length : 2 + separator.index + separator[0].length;
      return displayWidth(row.slice(0, end));
    };

    expect(new Set(rows.map(descriptionColumn)).size).toBe(1);
  });
});
