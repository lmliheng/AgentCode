// src/utils/input-line.ts
//
// 自己接管 stdin 的单行输入。
//
// 为什么要动手接管：`readline` 的 `question()` 只在回车那一刻兑现，中间的按键一个都不给，
// 而「行首敲 / 就出候选菜单」恰恰要求逐键感知。菜单不是叠在 readline 上的补丁，
// 它是这一帧渲染的一部分 —— 于是光标位置、折行、覆盖范围全由这里算。
//
// 两个纯函数（renderInputLine 与命令表那边的 renderSuggestionList）负责算「画什么」，
// 本文件只负责「怎么画」与按键语义，所以排版可以在没有 TTY 的测试里断言。
//
// 只在 TTY 下使用：非 TTY（管道、脚本）没有按键事件也没有列宽，调用方应退回 readline。

import { clearScreenDown, cursorTo, emitKeypressEvents, moveCursor } from 'node:readline';
import { stdin, stdout } from 'node:process';

import { commandQuery, matchCommands, renderSuggestionList } from './slash-commands.js';
import { charWidth, terminalWidth } from './terminal-width.js';

import type { Key } from 'node:readline';
import type { SlashCommand } from './slash-commands.js';

/** 用户按 Ctrl+C / Ctrl+D 中断了这一行输入 */
export class InputAborted extends Error {
  constructor() {
    super('输入被中断');
    this.name = 'InputAborted';
  }
}

export interface InputLineOptions {
  prompt: string;
  /** 不传就没有候选菜单：审批问答走这条，它不需要命令表 */
  commands?: readonly SlashCommand[];
}

export interface InputFrame {
  /** 输入行占的各行（可能折行） */
  lines: string[];
  /** 光标在第几行（lines 的下标） */
  cursorRow: number;
  /** 光标在该行的第几列 */
  cursorCol: number;
}

/**
 * 把「prompt + 已输入内容 + 光标位置」算成要写的几行，以及光标落在哪。
 *
 * 折行由这里显式插入换行决定，不依赖终端自动折行：自动折行后「这一帧占几行」在
 * 终端外面算不出来，重绘就会盖错位置。光标位置按显示列算，所以落在一个宽字符
 * 之后时不会错位。
 */
export function renderInputLine(
  prompt: string,
  buffer: string,
  cursor: number,
  width: number,
): InputFrame {
  const rows: string[] = [];
  let current = '';
  let col = 0;
  let cursorRow = 0;
  let cursorCol = 0;
  let placed = false;

  const place = (char: string): void => {
    const charColumns = charWidth(char);
    if (col + charColumns > width && current !== '') {
      rows.push(current);
      current = '';
      col = 0;
    }
    current += char;
    col += charColumns;
  };

  for (const char of prompt) place(char);

  // 光标是**码元**下标（与 String.slice 一致），逐码点走时要自己累加长度
  let index = 0;
  for (const char of buffer) {
    if (index === cursor) {
      cursorRow = rows.length;
      cursorCol = col;
      placed = true;
    }
    place(char);
    index += char.length;
  }

  if (!placed) {
    // 光标在行尾：正好占满一行时，这一帧要多留一行给光标落脚
    if (col >= width && current !== '') {
      rows.push(current);
      current = '';
    }
    cursorRow = rows.length;
    cursorCol = current === '' ? 0 : col;
  }

  rows.push(current);

  return { lines: rows, cursorRow, cursorCol };
}

/** 往前一个码点：不能把代理对劈成两半，否则光标会落进半个字符里 */
function prevCharIndex(text: string, index: number): number {
  if (index <= 0) return 0;
  const code = text.charCodeAt(index - 1);
  return code >= 0xdc00 && code <= 0xdfff ? Math.max(0, index - 2) : index - 1;
}

function nextCharIndex(text: string, index: number): number {
  if (index >= text.length) return text.length;
  const code = text.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff ? Math.min(text.length, index + 2) : index + 1;
}

/**
 * 读一行。返回值是**原样**的一行（含两端空白），裁剪由调用方决定。
 *
 * 按键语义：
 *   Enter      提交整行；菜单开着时先用高亮项补全命令名（`/qui` + Enter 等于 `/quit`）
 *   Tab        把高亮项补进输入行（接参数的补成 `/name `，不接的补成 `/name`）
 *   ↑↓         移动菜单高亮（循环）
 *   Esc        收起菜单，输入保留；再动一下输入菜单就回来
 *   Ctrl+C/D   中断，抛 InputAborted
 */
export async function readLine(options: InputLineOptions): Promise<string> {
  const commands = options.commands ?? [];

  return new Promise<string>((resolve, reject) => {
    let buffer = '';
    let cursor = 0;
    let rendered = false;
    /** 上一帧里光标所在行：回退到帧首行要从它往上数 */
    let caretRow = 0;

    const menu = {
      query: null as string | null,
      matches: [] as SlashCommand[],
      selected: 0,
      dismissed: false,
    };

    emitKeypressEvents(stdin);
    const wasRaw = stdin.isRaw === true;
    stdin.setRawMode(true);
    stdin.resume();

    const cleanup = (): void => {
      stdin.removeListener('keypress', onKeypress);
      if (!wasRaw) stdin.setRawMode(false);
      // 不 pause 的话 stdin 会一直保持流动，把事件循环留住：
      // 表现为 /quit 或 Ctrl+C 之后「话已经说完了，进程却卡着不退出」
      stdin.pause();
    };

    const syncMenu = (): void => {
      const query = commands.length === 0 ? null : commandQuery(buffer);
      const matches = query === null ? [] : matchCommands(commands, query);

      if (query !== menu.query) {
        menu.query = query;
        menu.selected = 0;
        // Esc 收起后，只要输入再变一次就把菜单放回来
        menu.dismissed = false;
      }

      menu.matches = matches;
      if (menu.selected >= matches.length) menu.selected = Math.max(0, matches.length - 1);
    };

    const render = (): InputFrame => {
      syncMenu();

      const frame = renderInputLine(options.prompt, buffer, cursor, terminalWidth());
      const rows = [...frame.lines, ...menuRows()];

      if (rendered) {
        cursorTo(stdout, 0);
        moveCursor(stdout, 0, -caretRow);
        clearScreenDown(stdout);
      }
      stdout.write(rows.join('\n'));

      const below = rows.length - 1 - frame.cursorRow;
      if (below > 0) moveCursor(stdout, 0, -below);
      cursorTo(stdout, frame.cursorCol);

      caretRow = frame.cursorRow;
      rendered = true;

      return frame;
    };

    /**
     * 把光标落到输入行最后一行的行尾。
     *
     * 换行之前必须先做这一步：raw 模式下 `\n` 只往下走一格、不回车，
     * 从输入行中间换行会让后续输出从那一列开始，整屏错位。
     */
    const endInputLine = (frame: InputFrame): void => {
      const end = renderInputLine(options.prompt, buffer, buffer.length, terminalWidth());

      const delta = end.cursorRow - frame.cursorRow;
      if (delta > 0) moveCursor(stdout, 0, delta);
      cursorTo(stdout, end.cursorCol);
    };

    const insert = (text: string): void => {
      buffer = buffer.slice(0, cursor) + text + buffer.slice(cursor);
      cursor += text.length;
      render();
    };

    const complete = (): void => {
      const command = menu.matches[menu.selected];
      if (menu.dismissed || command === undefined) return;

      buffer = `/${command.name}${command.takesArg ? ' ' : ''}`;
      cursor = buffer.length;
      render();
    };

    const submit = (): void => {
      // 只敲了一个 `/`（query 为空）时不做补全：那时候高亮的是第一条命令，
      // 拿它替掉用户只打了个头的输入太自作主张。Esc 收起菜单后同理。
      const command = menu.dismissed || menu.query === '' ? undefined : menu.matches[menu.selected];
      if (command !== undefined) {
        buffer = `/${command.name}`;
        cursor = buffer.length;
      }

      // 菜单先收掉再落笔，否则它会留在提交行下面
      menu.matches = [];
      menu.dismissed = true;

      endInputLine(render());

      cleanup();
      stdout.write('\n');
      resolve(buffer);
    };

    const abort = (): void => {
      // 菜单收掉、已输入的内容留在屏幕上，跟终端里 Ctrl+C 的习惯一致
      menu.matches = [];
      menu.dismissed = true;

      endInputLine(render());

      cleanup();
      stdout.write('\n');
      reject(new InputAborted());
    };

    const moveSelection = (delta: number): void => {
      if (menu.dismissed || menu.matches.length === 0) return;

      const count = menu.matches.length;
      menu.selected = (menu.selected + delta + count) % count;
      render();
    };

    const handled = (name: string | undefined, key: Key): boolean => {
      if (name === 'return' || name === 'enter') {
        submit();
        return true;
      }
      if (name === 'tab') {
        complete();
        return true;
      }
      if (name === 'escape') {
        menu.dismissed = true;
        render();
        return true;
      }
      if (name === 'up' || name === 'down') {
        moveSelection(name === 'up' ? -1 : 1);
        return true;
      }
      if (name === 'backspace') {
        if (cursor > 0) {
          const start = prevCharIndex(buffer, cursor);
          buffer = buffer.slice(0, start) + buffer.slice(cursor);
          cursor = start;
          render();
        }
        return true;
      }
      if (name === 'delete') {
        if (cursor < buffer.length) {
          buffer = buffer.slice(0, cursor) + buffer.slice(nextCharIndex(buffer, cursor));
          render();
        }
        return true;
      }
      if (name === 'left' || (key.ctrl && name === 'b')) {
        cursor = prevCharIndex(buffer, cursor);
        render();
        return true;
      }
      if (name === 'right' || (key.ctrl && name === 'f')) {
        cursor = nextCharIndex(buffer, cursor);
        render();
        return true;
      }
      if (name === 'home' || (key.ctrl && name === 'a')) {
        cursor = 0;
        render();
        return true;
      }
      if (name === 'end' || (key.ctrl && name === 'e')) {
        cursor = buffer.length;
        render();
        return true;
      }
      if (key.ctrl && name === 'u') {
        buffer = buffer.slice(cursor);
        cursor = 0;
        render();
        return true;
      }
      if (key.ctrl && name === 'w') {
        const head = buffer.slice(0, cursor).replace(/\s*\S*$/, '');
        buffer = head + buffer.slice(cursor);
        cursor = head.length;
        render();
        return true;
      }
      return false;
    };

    function onKeypress(sequence: string | undefined, key: Key): void {
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) {
        abort();
        return;
      }

      if (handled(key.name, key)) return;

      // 未识别的转义序列（功能键、某些终端的 Alt 组合）一律忽略：
      // 让它们掉进下面的插入分支会往输入行里塞进一堆 `[A` 之类的碎片
      if (key.ctrl || key.meta) return;
      if (sequence === undefined || sequence.startsWith('\u001b')) return;

      // 粘贴是一次多字符的 sequence；单行输入不留换行与其它控制字符
      const text = sequence.replace(/[\u0000-\u001f\u007f]/g, '');
      if (text !== '') insert(text);
    }

    const menuRows = (): string[] =>
      menu.dismissed || menu.matches.length === 0
        ? []
        : renderSuggestionList(menu.matches, menu.selected, terminalWidth());

    stdin.on('keypress', onKeypress);
    render();
  });
}
