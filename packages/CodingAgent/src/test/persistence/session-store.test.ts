// src/test/persistence/session-store.test.ts
//
// 覆盖会话事件流的落盘侧：
//   - 懒创建：没写事件之前不产生任何目录
//   - seq 跨重开连续（会话跨 run，seq 不能每次从头来）
//   - 残行修复与「坏行即日志结束」
//   - 会话查找：最后活跃时间的口径与平局确定化
//   - index.json 是派生产物，删掉不影响任何读取路径

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import {
  SessionStore,
  findMostRecentSession,
  listSessions,
  parseEventLines,
  rebuildWorkspaceIndex,
} from '../../persistence/session-store.js';
import {
  normalizeWorkspaceRoot,
  sessionDir,
  sessionEventsFile,
  sessionMetaFile,
  workspaceHash,
  sessionsRoot,
  SESSIONS_ROOT_ENV,
  workspaceIndexFile,
} from '../../persistence/paths.js';

const SESSION_A = '20260922-100000-aaaaaa';
const SESSION_B = '20260922-110000-bbbbbb';

let root = '';
let workspace = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'coding-agent-sessions-'));
  workspace = mkdtempSync(join(tmpdir(), 'coding-agent-ws-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

function started(taskId: string, description: string, ts: number) {
  return {
    type: 'task_started' as const,
    payload: { taskId, taskDescription: description, startTime: ts },
    ts,
  };
}

describe('工作区分区的路径归一', () => {
  it('盘符大小写的两种写法归到同一个分区', () => {
    if (process.platform !== 'win32') {
      // 该问题只在 Windows 上存在（与本机 vitest 小写盘符坑同源）
      return;
    }

    const lower = `c:${sep}Users${sep}Nobody${sep}project`;
    const upper = `C:${sep}Users${sep}Nobody${sep}project`;

    expect(normalizeWorkspaceRoot(lower).startsWith('C:')).toBe(true);
    expect(workspaceHash(lower)).toBe(workspaceHash(upper));
  });

  it('相对路径与冗余分隔符被 resolve 消掉', () => {
    expect(normalizeWorkspaceRoot(join(workspace, '.', ''))).toBe(
      normalizeWorkspaceRoot(workspace),
    );
  });

  it('会话 ID 可排序：按目录名排即按创建时间排', () => {
    expect(SESSION_A < SESSION_B).toBe(true);
  });
});

describe('懒创建', () => {
  it('只构造不写事件时，不产生任何目录或文件', () => {
    const store = new SessionStore(workspace, SESSION_A, { root });

    expect(existsSync(store.dir)).toBe(false);
    expect(existsSync(store.eventsFile)).toBe(false);
    expect(existsSync(store.metaFile)).toBe(false);
  });

  it('第一条事件落盘时才建目录、写会话头与 blobs 预留目录', () => {
    const store = new SessionStore(workspace, SESSION_A, { root });
    store.append(started('task-1', '第一个任务', 1000));

    expect(existsSync(store.dir)).toBe(true);
    expect(existsSync(store.eventsFile)).toBe(true);
    expect(existsSync(store.metaFile)).toBe(true);
    expect(existsSync(store.blobsDir)).toBe(true);

    const meta = store.readMeta();
    expect(meta?.sessionId).toBe(SESSION_A);
    // 分区用规范化路径，会话头里留的是原文，便于人工核对
    expect(meta?.workspaceRoot).toBe(workspace);
  });
});

describe('事件流的写入与读取', () => {
  it('seq 在会话内单调递增，且重开同一会话后接着走', () => {
    const first = new SessionStore(workspace, SESSION_A, { root });
    expect(first.append(started('task-1', '任务一', 1000)).seq).toBe(1);
    expect(first.append(started('task-2', '任务二', 2000)).seq).toBe(2);

    const reopened = new SessionStore(workspace, SESSION_A, { root });
    expect(reopened.append(started('task-3', '任务三', 3000)).seq).toBe(3);

    expect(reopened.readEvents().map((event) => event.seq)).toEqual([1, 2, 3]);
  });

  it('追加前先截掉末尾残行，新事件不会粘在坏行后面', () => {
    const store = new SessionStore(workspace, SESSION_A, { root });
    store.append(started('task-1', '任务一', 1000));

    // 模拟进程被杀：最后一行只写了一半
    appendFileSync(store.eventsFile, '{"v":1,"seq":2,"ts":2000,"type":"deci', 'utf8');

    const reopened = new SessionStore(workspace, SESSION_A, { root });
    const event = reopened.append(started('task-2', '任务二', 3000));

    // 残行被截掉，seq 从 1 往后接 —— 而不是把残行当成第 2 条
    expect(event.seq).toBe(2);
    expect(reopened.readEvents().map((e) => e.seq)).toEqual([1, 2]);

    const lines = readFileSync(store.eventsFile, 'utf8').split('\n').filter((line) => line !== '');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('读到坏行即停止，已解析的部分不回滚', () => {
    const parsed = parseEventLines(
      [
        JSON.stringify({ v: 1, seq: 1, ts: 1000, type: 'task_started', payload: {} }),
        '这不是 JSON',
        JSON.stringify({ v: 1, seq: 2, ts: 2000, type: 'stopped', payload: {} }),
      ].join('\n'),
    );

    expect(parsed.events.map((event) => event.seq)).toEqual([1]);
    expect(parsed.truncated).toBe(true);
    // 坏行之后的合法行算作丢弃：坏行之后的内容按约定不可信
    expect(parsed.dropped).toBe(2);
  });

  it('未知事件类型不是坏行：解析照收，交给重放阶段忽略', () => {
    const parsed = parseEventLines(
      [
        JSON.stringify({ v: 1, seq: 1, ts: 1000, type: 'metrics_snapshot', payload: { a: 1 } }),
        JSON.stringify({ v: 1, seq: 2, ts: 2000, type: 'stopped', payload: {} }),
      ].join('\n'),
    );

    expect(parsed.events).toHaveLength(2);
    expect(parsed.truncated).toBe(false);
  });
});

describe('会话查找', () => {
  it('「最近」按最后活跃时间，不按创建时间', () => {
    // A 先创建，但最后一条事件最晚；B 后创建却早已停用
    const early = new SessionStore(workspace, SESSION_A, { root });
    early.append(started('task-a', '早先的会话', 1000));
    early.append(started('task-a2', '刚刚又聊了一句', 9000));

    const late = new SessionStore(workspace, SESSION_B, { root });
    late.append(started('task-b', '后创建但停用的会话', 5000));

    expect(findMostRecentSession(workspace, { root })?.sessionId).toBe(SESSION_A);
  });

  it('最后活跃时间平局时取 sessionId 较大者，结果稳定', () => {
    const a = new SessionStore(workspace, SESSION_A, { root });
    a.append(started('task-a', 'A', 1000));

    const b = new SessionStore(workspace, SESSION_B, { root });
    b.append(started('task-b', 'B', 1000));

    const first = findMostRecentSession(workspace, { root })?.sessionId;
    const second = findMostRecentSession(workspace, { root })?.sessionId;

    expect(first).toBe(SESSION_B);
    expect(second).toBe(first);
  });

  it('没有会话时返回 null，不抛错', () => {
    expect(findMostRecentSession(workspace, { root })).toBeNull();
    expect(listSessions(workspace, { root })).toEqual([]);
  });

  it('空会话（目录在但没有可解析事件）不进列表', () => {
    const store = new SessionStore(workspace, SESSION_A, { root });
    // 只造目录与手工写坏的事件流
    store.append(started('task-1', '任务一', 1000));
    writeFileSync(store.eventsFile, '半行坏内容', 'utf8');

    expect(listSessions(workspace, { root })).toEqual([]);
  });

  it('非会话 ID 形状的目录被忽略', () => {
    const store = new SessionStore(workspace, SESSION_A, { root });
    store.append(started('task-1', '任务一', 1000));

    const stray = join(store.dir, '..', 'notes');
    writeFileSync(stray, '这不是会话', 'utf8');

    expect(listSessions(workspace, { root }).map((s) => s.sessionId)).toEqual([SESSION_A]);
  });
});

describe('index.json 是派生产物', () => {
  it('stopped 事件触发清单快照落盘', () => {
    const store = new SessionStore(workspace, SESSION_A, { root });
    store.append(started('task-1', '任务一', 1000));
    store.append({
      type: 'stopped',
      payload: {
        tokenUsage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cacheHitTokens: null,
          cacheMissTokens: null,
          cacheComplete: true,
          complete: true,
        },
        iterationCount: 0,
        toolCallCount: 0,
        fileChanges: [],
      },
      ts: 2000,
    });

    const indexPath = workspaceIndexFile(workspace, root);
    expect(existsSync(indexPath)).toBe(true);
    const snapshot = JSON.parse(readFileSync(indexPath, 'utf8')) as { sessions: unknown[] };
    expect(snapshot.sessions).toHaveLength(1);
  });

  it('删掉 index.json 后读取路径完全不受影响', () => {
    const store = new SessionStore(workspace, SESSION_A, { root });
    store.append(started('task-1', '任务一', 1000));
    rebuildWorkspaceIndex(workspace, { root });

    const before = listSessions(workspace, { root });
    rmSync(workspaceIndexFile(workspace, root), { force: true });
    const after = listSessions(workspace, { root });

    expect(after).toEqual(before);
    expect(findMostRecentSession(workspace, { root })?.sessionId).toBe(SESSION_A);
  });
});

describe('环境变量覆盖会话根目录', () => {
  it('未显式传 root 时取环境变量', () => {
    const previous = process.env[SESSIONS_ROOT_ENV];
    process.env[SESSIONS_ROOT_ENV] = root;
    try {
      expect(sessionsRoot()).toBe(root);

      const store = SessionStore.open(workspace);
      store.append(started('task-1', '任务一', 1000));

      expect(sessionDir(workspace, store.sessionId)).toBe(store.dir);
      expect(existsSync(sessionEventsFile(workspace, store.sessionId))).toBe(true);
      expect(existsSync(sessionMetaFile(workspace, store.sessionId))).toBe(true);
      expect(listSessions(workspace)).toHaveLength(1);
    } finally {
      if (previous === undefined) {
        delete process.env[SESSIONS_ROOT_ENV];
      } else {
        process.env[SESSIONS_ROOT_ENV] = previous;
      }
    }
  });
});
