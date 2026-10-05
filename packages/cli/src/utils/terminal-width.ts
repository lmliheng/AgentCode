// src/utils/terminal-width.ts
//
// 终端列宽计算：把「占几列」和「占几个码元」分开。
//
// 中文、全角标点、假名、谚文在终端里占两列，按 String.length 补空格必然错位。
// 这一层是纯函数，不碰 stdout：宽度由调用方给出（TTY 下是 process.stdout.columns）。
//
// 单独成文件是因为有三个地方要用它：cli.ts 的信息块排版、命令候选菜单、输入行折行。
// 留在 cli.ts 里会让「cli.ts → 命令表 → cli.ts」成环。

/** 剥掉 ANSI 转义后再数：颜色码不占列宽，算进去会让带色的那几行整段右移 */
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

/** 单个字符占的列数。传入代理对（如 emoji、生僻字）时按整对算 */
export function charWidth(char: string): number {
  return isWideCodePoint(char.codePointAt(0) ?? 0) ? 2 : 1;
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text.replace(ANSI_PATTERN, '')) {
    width += charWidth(char);
  }
  return width;
}

/** East Asian Wide / Fullwidth 区段：CJK 汉字、全角标点、假名、谚文 */
function isWideCodePoint(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

/**
 * 按显示列数截断，超出部分用省略号收尾。
 *
 * 菜单的每一行都必须正好占一行：终端自动折行会把「这一帧占几行」的账算错，
 * 重绘时就会盖错位置。所以宁可截断，也不让描述文字撑出宽度。
 */
export function truncateToWidth(text: string, width: number, ellipsis = '…'): string {
  if (displayWidth(text) <= width) return text;

  const room = width - displayWidth(ellipsis);
  if (room <= 0) return '';

  let kept = '';
  let used = 0;
  for (const char of text) {
    const width_ = charWidth(char);
    if (used + width_ > room) break;
    kept += char;
    used += width_;
  }
  return kept + ellipsis;
}

/**
 * 当前终端宽度。
 *
 * 非 TTY（管道、重定向到文件）下 columns 拿不到，此时用 fallback。
 * 输入行折行与菜单截断都依赖它 —— 它们只在 TTY 下运行，所以这里取不到真值时
 * 说明调用时机不对，而不是「排版宽一点也无妨」。
 */
export function terminalWidth(fallback = 80): number {
  const columns = process.stdout.columns;
  return typeof columns === 'number' && columns > 0 ? columns : fallback;
}
