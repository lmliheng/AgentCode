// src/test/cli/view.test.ts
//
// 覆盖会话 CLI 的终端呈现层：停止原因的人读翻译、用量口径的展示、信息块的对齐。
//
// 这一层只翻译不改写：机器可读的 stopReason 与 tokenUsage 原样保留在 state 与事件流里，
// 所以这里断言的都是「给人看的那一份」，且不依赖终端是否支持颜色。

import { describe, it, expect } from 'vitest';

import {
  describeCacheUsage,
  describeContextSize,
  describeObservation,
  describeStopReason,
  displayWidth,
  paint,
  panel,
  viewOfRoundUsage,
} from '../../cli.js';

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
const plain = (text: string): string => text.replace(ANSI_PATTERN, '');

describe('停止原因的人读翻译', () => {
  it('任务完成是正面结论', () => {
    expect(describeStopReason({ type: 'task_completed' })).toEqual({
      text: '任务完成',
      tone: 'ok',
    });
  });

  it('各类上限停止都带上实际的上限值', () => {
    expect(describeStopReason({ type: 'max_iterations', limit: 50 }).text).toContain('50 轮');
    expect(describeStopReason({ type: 'max_tool_calls', limit: 100 }).text).toContain('100 次');
    expect(describeStopReason({ type: 'max_file_changes', limit: 20 }).text).toContain('20 处');
    expect(describeStopReason({ type: 'max_tool_calls', limit: 100 }).tone).toBe('warn');
  });

  it('文件变更上限与迭代上限必须能区分开', () => {
    // 二者曾经共用 max_iterations，展示层于是必然把其中一种说错
    expect(describeStopReason({ type: 'max_file_changes', limit: 20 }).text)
      .not.toBe(describeStopReason({ type: 'max_iterations', limit: 20 }).text);
  });

  it('超时按人读时长呈现，而不是毫秒数', () => {
    expect(describeStopReason({ type: 'timeout', durationMs: 300_000 }).text)
      .toBe('超过时间上限（5 分钟）');
    expect(describeStopReason({ type: 'timeout', durationMs: 1_500 }).text)
      .toBe('超过时间上限（2 秒）');
  });

  it('出错停止保留原始原因，并标记为异常', () => {
    const described = describeStopReason({ type: 'error', message: '检测到重复的 Action' });

    expect(described.tone).toBe('bad');
    expect(described.text).toContain('检测到重复的 Action');
  });

  it('没有停止原因时不冒充完成', () => {
    expect(describeStopReason(undefined)).toEqual({ text: '未记录停止原因', tone: 'note' });
  });
});

describe('用量口径的展示', () => {
  it('拿不到缓存命中量时说未报告，而不是显示 0', () => {
    expect(describeCacheUsage({ promptTokens: 100, cacheHitTokens: null, cacheMissTokens: null }))
      .toEqual({ text: '未报告', tone: 'note' });
  });

  it('命中率按输入量算，并按高低给语气', () => {
    expect(describeCacheUsage({ promptTokens: 1000, cacheHitTokens: 900, cacheMissTokens: 100 }))
      .toEqual({ text: '命中 900 / 未命中 100 · 命中率 90.0%', tone: 'ok' });

    expect(describeCacheUsage({ promptTokens: 1000, cacheHitTokens: 750, cacheMissTokens: 250 }).tone)
      .toBe('warn');
    // 一半命中在稳定前缀占大头的工作负载里已属异常，不按「轻微提醒」处理
    expect(describeCacheUsage({ promptTokens: 1000, cacheHitTokens: 500, cacheMissTokens: 500 }).tone)
      .toBe('bad');
    expect(describeCacheUsage({ promptTokens: 1000, cacheHitTokens: 100, cacheMissTokens: 900 }).tone)
      .toBe('bad');
  });

  it('未命中量缺失时显示未知，而不是当成 0', () => {
    expect(describeCacheUsage({ promptTokens: 100, cacheHitTokens: 40, cacheMissTokens: null }).text)
      .toContain('未命中 未知');
  });

  it('单轮用量的 undefined 与累计记录的 null 归一到同一形状', () => {
    expect(viewOfRoundUsage({ promptTokens: 10 }))
      .toEqual({ promptTokens: 10, cacheHitTokens: null, cacheMissTokens: null });
    expect(viewOfRoundUsage({ promptTokens: 10, cacheHitTokens: 4, cacheMissTokens: 6 }))
      .toEqual({ promptTokens: 10, cacheHitTokens: 4, cacheMissTokens: 6 });
  });

  it('当前上下文大小标出来源，未知时不冒充 0', () => {
    expect(describeContextSize({ tokens: null, source: 'unknown' })).toBe('未知');
    // 千分位用同一个 toLocaleString 生成，避免断言跟着机器 locale 走
    const expected = (3710).toLocaleString();
    expect(describeContextSize({ tokens: 3710, source: 'measured' })).toBe(`${expected} tokens（实测）`);
    expect(describeContextSize({ tokens: 3710, source: 'estimated' })).toBe(`${expected} tokens（估算）`);
  });
});

describe('工具观察的标题', () => {
  it('把工具自己产出的执行细节接在工具名后面', () => {
    expect(describeObservation('read_file', 'src/cli.ts 第 12–45 行 / 共 320 行'))
      .toBe('read_file src/cli.ts 第 12–45 行 / 共 320 行');
    expect(describeObservation('read_directory', 'src/tools / 12 个文件、3 个目录'))
      .toBe('read_directory src/tools / 12 个文件、3 个目录');
  });

  it('工具没写细节时退回只有工具名，而不是留一段空话', () => {
    // 新工具或将来接入的 MCP 工具不写 display，不能因此变成哑巴
    expect(describeObservation('read_file', undefined)).toBe('read_file');
    expect(describeObservation('read_file', '')).toBe('read_file');
    expect(describeObservation('read_file', '   ')).toBe('read_file');
  });

  it('细节两端的空白不进入标题（避免出现双空格）', () => {
    expect(describeObservation('read_file', '  src/a.ts 第 1–2 行  '))
      .toBe('read_file src/a.ts 第 1–2 行');
  });
});

describe('信息块的排版', () => {
  it('中文与彩色都不破坏对齐：每行显示宽度相同', () => {
    const block = panel('本轮结果', [
      ['停止', paint('ok', '✓ 任务完成')],
      ['决策', '1 轮 · 工具 0 次'],
      ['缓存', paint('warn', '命中 6,656 / 未命中 491 · 命中率 93.1%')],
      ['上下文', '3,710 tokens（实测）'],
    ]);

    const widths = new Set(block.split('\n').map(displayWidth));
    expect(widths.size).toBe(1);
  });

  it('标签列按最长标签对齐，取值从同一列开始', () => {
    const rows = panel('会话', [
      ['工作区', 'AAA'],
      ['会话', 'BBB'],
    ]).split('\n').slice(1).map(plain);

    // 必须按显示列比，不能按 indexOf 的码元下标比：
    // 「工作区」3 个码元但占 6 列，「会话」2 个码元占 4 列，补空格后两者列位置相同、码元下标不同。
    const valueColumn = (line: string, value: string): number =>
      displayWidth(line.slice(0, line.indexOf(value)));

    expect(valueColumn(rows[0]!, 'AAA')).toBe(valueColumn(rows[1]!, 'BBB'));
  });

  it('宽度按显示列算：中文与全角标点各占两列', () => {
    expect(displayWidth('工作区')).toBe(6);
    expect(displayWidth('（测试）')).toBe(8);
    expect(displayWidth('abc')).toBe(3);
  });

  it('ANSI 转义不占列宽', () => {
    expect(displayWidth('\u001b[31mabc\u001b[39m')).toBe(3);
  });
});
