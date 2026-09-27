// src/test/cli/input-line.test.ts
//
// 覆盖输入行的排版：折行怎么切、光标落在哪、中文占几列。
//
// 只测纯渲染部分。按键语义（Tab 补全、↑↓ 选中、Ctrl+C）要真实 TTY 才跑得起来，
// 这里测不了 —— 但排版是重绘的根：它算错，菜单和光标就会盖错位置，而那是最难肉眼定位的 bug。

import { describe, it, expect } from 'vitest';

import { renderInputLine } from '../../utils/input-line.js';
import { displayWidth } from '../../utils/terminal-width.js';

describe('输入行的排版', () => {
  it('没有输入时光标紧跟在提示符后面', () => {
    const frame = renderInputLine('> ', '', 0, 80);

    expect(frame.lines).toEqual(['> ']);
    expect(frame.cursorRow).toBe(0);
    expect(frame.cursorCol).toBe(2);
  });

  it('光标落在输入中间时按已走的列数算', () => {
    const frame = renderInputLine('> ', 'abcd', 2, 80);

    expect(frame.lines).toEqual(['> abcd']);
    expect(frame.cursorCol).toBe(4);
  });

  it('中文占两列，按列数算而不是按码元数', () => {
    const frame = renderInputLine('> ', '中文', 2, 80);

    expect(frame.cursorRow).toBe(0);
    expect(frame.cursorCol).toBe(6);
  });

  it('超出宽度时折行，光标跟着走到下一行', () => {
    // 提示符 2 列 + 10 个字符，宽度 10：第一行放得下「> abcdefgh」，剩下「ij」
    const frame = renderInputLine('> ', 'abcdefghij', 10, 10);

    expect(frame.lines).toEqual(['> abcdefgh', 'ij']);
    expect(frame.cursorRow).toBe(1);
    expect(frame.cursorCol).toBe(2);
  });

  it('光标正好落在折行边界上时，给它留出下一行的行首', () => {
    // 2 列提示符 + 8 个字符正好占满 10 列，此时光标不能停在第 11 列
    const frame = renderInputLine('> ', 'abcdefgh', 8, 10);

    expect(frame.lines).toEqual(['> abcdefgh', '']);
    expect(frame.cursorRow).toBe(1);
    expect(frame.cursorCol).toBe(0);
  });

  it('宽字符顶到行尾时整字换行，不劈成半个', () => {
    // 宽度 4：三个半角字符占 3 列后，「中」需要 2 列，只能整字挪到下一行
    const frame = renderInputLine('', 'aaa中', 4, 4);

    expect(frame.lines).toEqual(['aaa', '中']);
    expect(frame.cursorRow).toBe(1);
    expect(frame.cursorCol).toBe(2);
  });

  it('光标在宽字符前后都不会落进字的中间', () => {
    expect(renderInputLine('> ', '中a', 0, 80).cursorCol).toBe(2);
    expect(renderInputLine('> ', '中a', 1, 80).cursorCol).toBe(4);
  });

  it('代理对按一个字符算：光标穿过它时列数只加一次', () => {
    // U+1D11E 在 UTF-16 里占两个码元，但只占一列
    expect(renderInputLine('> ', '𝄞', 0, 80).cursorCol).toBe(2);
    expect(renderInputLine('> ', '𝄞', 2, 80).cursorCol).toBe(3);
  });

  it('光标超出内容长度时按行尾处理，不越界', () => {
    const frame = renderInputLine('> ', 'ab', 99, 80);

    expect(frame.cursorCol).toBe(4);
    expect(frame.cursorRow).toBeLessThan(frame.lines.length);
  });

  it('每行的显示宽度都不超过给定宽度', () => {
    for (const width of [4, 8, 10, 20]) {
      const frame = renderInputLine('> ', '中文字符abc中', 9, width);

      for (const line of frame.lines) {
        expect(displayWidth(line)).toBeLessThanOrEqual(width);
      }
      expect(frame.cursorRow).toBeLessThan(frame.lines.length);
      expect(frame.cursorCol).toBeLessThanOrEqual(Math.max(width, 2));
    }
  });

  it('退化宽度下也不崩：每行只放一个字符，光标仍落在某一行内', () => {
    const frame = renderInputLine('> ', 'ab', 2, 1);

    expect(frame.cursorRow).toBeLessThan(frame.lines.length);
    expect(frame.lines.every((line) => displayWidth(line) <= 1)).toBe(true);
  });
});
