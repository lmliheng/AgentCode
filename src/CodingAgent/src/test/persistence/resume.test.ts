// src/test/persistence/resume.test.ts
//
// 覆盖「--resume 该接到哪个会话」的判定，重点是失败路径：
//   - 不带参数时取当前工作区最后活跃的会话
//   - 找不到 / 空会话 / 跨工作区 各有不同的说法，且都不静默降级成新会话
//   - 失败时始终给出可用会话列表

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SessionStore, listSessions } from '../../persistence/session-store.js';
import { formatSessionList, resolveResumeTarget } from '../../persistence/resume.js';

const SESSION_EARLY = '20260922-100000-aaaaaa';
const SESSION_LATE = '20260922-110000-bbbbbb';

let root = '';
let workspaceA = '';
let workspaceB = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'coding-agent-sessions-'));
  workspaceA = mkdtempSync(join(tmpdir(), 'coding-agent-ws-a-'));
  workspaceB = mkdtempSync(join(tmpdir(), 'coding-agent-ws-b-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(workspaceA, { recursive: true, force: true });
  rmSync(workspaceB, { recursive: true, force: true });
});

function seed(workspace: string, sessionId: string, description: string, at: number): SessionStore {
  const store = new SessionStore(workspace, sessionId, { root });
  store.append({
    type: 'task_started',
    payload: { taskId: `task-${sessionId}`, taskDescription: description, startTime: at },
    ts: at,
  });
  return store;
}

describe('恢复目标的选择', () => {
  it('不带参数时取当前工作区最后活跃的会话', () => {
    seed(workspaceA, SESSION_EARLY, '早先的会话', 1000);
    seed(workspaceA, SESSION_LATE, '后来的会话', 5000);

    const resolution = resolveResumeTarget(workspaceA, undefined, { root });

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.target.sessionId).toBe(SESSION_LATE);
  });

  it('指定 ID 时恢复那个会话，并把历史 run 交回来', () => {
    seed(workspaceA, SESSION_EARLY, '早先的会话', 1000);
    seed(workspaceA, SESSION_LATE, '后来的会话', 5000);

    const resolution = resolveResumeTarget(workspaceA, SESSION_EARLY, { root });

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.target.sessionId).toBe(SESSION_EARLY);
    expect(resolution.target.runs).toHaveLength(1);
    expect(resolution.target.runs[0]!.taskDescription).toBe('早先的会话');
    // 会话头里留着创建时的工作区原文，便于核对
    expect(resolution.target.sessionWorkspace).toBe(workspaceA);
  });
});

describe('失败路径都不静默降级', () => {
  it('一个会话都没有时明确报告', () => {
    const resolution = resolveResumeTarget(workspaceA, undefined, { root });

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toBe('no_sessions');
    expect(resolution.available).toEqual([]);
    expect(resolution.message).toContain(workspaceA);
  });

  it('指定的会话不存在时列出可用会话', () => {
    seed(workspaceA, SESSION_LATE, '唯一存在的会话', 5000);

    const resolution = resolveResumeTarget(workspaceA, SESSION_EARLY, { root });

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toBe('session_not_found');
    expect(resolution.available.map((s) => s.sessionId)).toEqual([SESSION_LATE]);
    // 失败信息要能让人直接看到该接哪个
    expect(formatSessionList(resolution.available)).toContain(SESSION_LATE);
  });

  it('会话存在但事件流没有可解析内容时单独说明', () => {
    const store = seed(workspaceA, SESSION_EARLY, '坏掉的会话', 1000);
    writeFileSync(store.eventsFile, '半行坏内容', 'utf8');

    const resolution = resolveResumeTarget(workspaceA, SESSION_EARLY, { root });

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toBe('session_empty');
    expect(resolution.message).toContain(SESSION_EARLY);
  });

  it('会话属于另一个工作区时拒绝，并指出是哪个工作区', () => {
    seed(workspaceB, SESSION_EARLY, 'B 工作区的会话', 1000);

    // 在 A 下请求 B 的会话：分区不同，A 的列表里根本没有它
    const resolution = resolveResumeTarget(workspaceA, SESSION_EARLY, { root });

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toBe('workspace_mismatch');
    expect(resolution.message).toContain(workspaceB);
  });

  it('工作区路径的盘符大小写不同仍算同一个工作区', () => {
    if (process.platform !== 'win32') return;

    const store = seed(workspaceA, SESSION_EARLY, '同一个工作区', 1000);
    const lowercase = workspaceA.replace(/^([A-Z]):/, (_, drive: string) => `${drive.toLowerCase()}:`);

    // 同一个目录换个盘符大小写写法：分区哈希相同 → 仍然找得到
    expect(store.sessionId).toBe(SESSION_EARLY);
    const resolution = resolveResumeTarget(lowercase, SESSION_EARLY, { root });
    expect(resolution.ok).toBe(true);
  });
});

describe('可用会话列表的人读格式', () => {
  it('没有会话时给出明确说明', () => {
    expect(formatSessionList([])).toContain('没有会话');
  });

  it('列出会话 ID、最后活跃时间与体量', () => {
    seed(workspaceA, SESSION_EARLY, '会话', 1000);

    const text = formatSessionList(listSessions(workspaceA, { root }), 5000);

    expect(text).toContain(SESSION_EARLY);
    expect(text).toContain('最后活跃');
  });
});
