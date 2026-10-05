// src/test/persistence/session-admin.test.ts
//
// 会话的「管理」侧：导出与删除。
//
// 这两件事的共同点是都会被「人」直接消费 —— 导出的 Markdown 是拿去看的，
// 删除是不可逆的。所以测试钉的是：导出内容确实包含了排查所需的事实
// （尤其是「送给模型的量与原始产出之差」这种不写下来就查不到的东西），
// 以及删除在越界与不存在时一律拒绝。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SessionStore, deleteSession, listSessions } from '../src/persistence/session-store.js';
import { renderSessionMarkdown } from '../src/persistence/session-export.js';
import { sessionDir } from '../src/persistence/paths.js';
import type { StoredSessionEvent } from '../src/persistence/events.js';

const SESSION_A = '20260922-100000-aaaaaa';
const SESSION_B = '20260922-110000-bbbbbb';

let root = '';
let workspace = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'acode-admin-sessions-'));
  workspace = mkdtempSync(join(tmpdir(), 'acode-admin-ws-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

/** 造一个有内容的会话：规划 → 一次调用 → 收尾 */
function seedSession(sessionId: string, now: () => number): SessionStore {
  const store = new SessionStore(workspace, sessionId, { root, now });
  store.append({
    type: 'task_started',
    payload: { taskId: 't1', taskDescription: '把 README 补一段', startTime: now() },
  });
  store.append({
    type: 'plan_updated',
    payload: {
      plan: {
        originalGoal: '把 README 补一段',
        version: 1,
        currentStepIndex: 0,
        steps: [{
          id: 's1',
          description: '读 README',
          status: 'completed',
          dependsOn: [],
          completionCriteria: '看到文件内容',
        }],
      },
    },
  });
  store.append({
    type: 'decision',
    payload: {
      decision: { type: 'Action', tool: 'read_file', params: { path: 'README.md' }, thought: '先看看' },
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    },
  });
  store.append({
    type: 'observation',
    payload: {
      observation: {
        action: { type: 'Action', tool: 'read_file', params: { path: 'README.md' } },
        result: { success: true, data: { content: 'x'.repeat(5000) } },
        timestamp: now(),
        delivery: { rawChars: 5200, deliveredChars: 900, truncated: true, fullOutputPath: '/tmp/full.txt' },
      },
    },
  });
  store.append({
    type: 'stopped',
    payload: {
      stopReason: { type: 'task_completed' },
      tokenUsage: {
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
        cacheHitTokens: null,
        cacheMissTokens: null,
        cacheComplete: true,
        complete: true,
      },
      iterationCount: 1,
      toolCallCount: 1,
      fileChanges: [],
    },
  });
  return store;
}

describe('会话导出', () => {
  it('导出的是事件流本身：任务、计划、决策、观察、停止原因都在', () => {
    const store = seedSession(SESSION_A, () => 1_700_000_000_000);
    const markdown = renderSessionMarkdown(store.readEvents());

    expect(markdown).toContain('# 会话记录');
    expect(markdown).toContain('把 README 补一段');
    expect(markdown).toContain('- [x] 1. 读 README');
    expect(markdown).toContain('read_file');
    expect(markdown).toContain('停止：任务完成');
    // 事件顺序就是因果顺序，不能被重排
    expect(markdown.indexOf('### #1 task_started')).toBeLessThan(markdown.indexOf('### #5 stopped'));
  });

  it('写出「送出的量」而不只是原始产出 —— 这是事后归因 token 的唯一线索', () => {
    const store = seedSession(SESSION_A, () => 1_700_000_000_000);
    const markdown = renderSessionMarkdown(store.readEvents());

    expect(markdown).toContain('送出量：900 / 5200 字符（已截断）');
  });

  it('超大正文被截断并有省略说明，导出不会变成几 MB', () => {
    const store = seedSession(SESSION_A, () => 1_700_000_000_000);
    const markdown = renderSessionMarkdown(store.readEvents(), { maxObservationChars: 50 });

    expect(markdown).toContain('省略');
    expect(markdown.length).toBeLessThan(10_000);
  });

  it('空会话也能导出：给一句说明而不是空文件', () => {
    const events: StoredSessionEvent[] = [];
    expect(renderSessionMarkdown(events)).toContain('没有任何事件');
  });

  it('未知事件类型被点出来，而不是静默略过', () => {
    const events: StoredSessionEvent[] = [
      { v: 1, seq: 1, ts: 1, type: 'future_thing' as never, payload: { a: 1 } },
    ];
    const markdown = renderSessionMarkdown(events);
    expect(markdown).toContain('未知事件类型');
    expect(markdown).toContain('future_thing');
  });
});

describe('会话删除', () => {
  it('删掉目录并从清单里消失', () => {
    seedSession(SESSION_A, () => 1_700_000_000_000);
    seedSession(SESSION_B, () => 1_700_000_001_000);
    expect(listSessions(workspace, { root }).map(s => s.sessionId)).toEqual([SESSION_A, SESSION_B]);

    const result = deleteSession(workspace, SESSION_A, { root });

    expect(result.deleted).toBe(true);
    expect(existsSync(sessionDir(workspace, SESSION_A, root))).toBe(false);
    expect(listSessions(workspace, { root }).map(s => s.sessionId)).toEqual([SESSION_B]);
  });

  it('不合法的会话 ID 直接拒绝（它会被拼进路径，放任就是目录穿越）', () => {
    seedSession(SESSION_A, () => 1_700_000_000_000);

    for (const bad of ['../etc', '..', 'not-a-session-id', '']) {
      const result = deleteSession(workspace, bad, { root });
      expect(result.deleted).toBe(false);
      expect(result.reason).toBeTruthy();
    }

    // 合法的那个还在
    expect(existsSync(sessionDir(workspace, SESSION_A, root))).toBe(true);
  });

  it('不存在的会话如实说没删到，不假装成功', () => {
    const result = deleteSession(workspace, SESSION_B, { root });
    expect(result.deleted).toBe(false);
    expect(result.reason).toContain('不存在');
  });
});
