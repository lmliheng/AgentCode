// src/test/session-command.test.ts
//
// `/session` 的子命令：删除与导出。
//
// 这两条都会动真实文件，所以钉的是边界而不是文案：
//   - 删不掉的东西（当前会话、非法 ID、不存在的 ID）必须拒绝并说清原因；
//   - 导出不给文件名时只打印，给文件名时写到工作区里 —— 不能默认往用户工作区写文件。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SessionStore } from '@lmliheng/acode-core';
import { SESSIONS_ROOT_ENV, sessionDir } from '@lmliheng/acode-core';
import { runSessionCommand } from '../src/cli.js';

let workspace = '';
let root = '';

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'acode-session-cmd-ws-'));
  // 会话根也用临时目录：绝不能拿真实会话做这些用例（其中一条真的会删东西）。
  // 覆盖环境变量而不是传 root 参数：runSessionCommand 走的是 CLI 自己那条路径，
  // 测的就该是它实际会用的解析方式。
  root = mkdtempSync(join(tmpdir(), 'acode-session-cmd-root-'));
  process.env[SESSIONS_ROOT_ENV] = root;
});

afterEach(() => {
  delete process.env[SESSIONS_ROOT_ENV];
  rmSync(workspace, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

/** 造一个有内容的会话（会话根取自 ACODE_SESSIONS_ROOT） */
function seed(sessionId: string): void {
  const store = new SessionStore(workspace, sessionId);
  store.append({
    type: 'task_started',
    payload: { taskId: 't1', taskDescription: '造一个会话', startTime: Date.now() },
  });
}

describe('/session 子命令', () => {
  it('不带参数时给用法，而不是默默什么都没做', () => {
    const { text } = runSessionCommand({ workspacePath: workspace, currentSessionId: 'x', arg: '' });
    expect(text).toContain('用法');
    expect(text).toContain('export');
  });

  it('拒绝删除当前会话（它是正在写的那个文件）', () => {
    seed('20260922-100000-aaaaaa');

    const { text } = runSessionCommand({
      workspacePath: workspace,
      currentSessionId: '20260922-100000-aaaaaa',
      arg: 'rm 20260922-100000-aaaaaa',
    });

    expect(text).toContain('当前会话');
    expect(existsSync(sessionDir(workspace, '20260922-100000-aaaaaa'))).toBe(true);
  });

  it('删掉别的会话，并说明工作区里的文件没动', () => {
    seed('20260922-100000-aaaaaa');
    seed('20260922-110000-bbbbbb');

    const { text } = runSessionCommand({
      workspacePath: workspace,
      currentSessionId: '20260922-110000-bbbbbb',
      arg: 'rm 20260922-100000-aaaaaa',
    });

    expect(text).toContain('已删除');
    expect(text).toContain('文件没动');
    expect(existsSync(sessionDir(workspace, '20260922-100000-aaaaaa'))).toBe(false);
    expect(existsSync(sessionDir(workspace, '20260922-110000-bbbbbb'))).toBe(true);
  });

  it('非法 ID 与不存在的 ID 都被拒绝，且原因不同', () => {
    const illegal = runSessionCommand({ workspacePath: workspace, currentSessionId: 'x', arg: 'rm ../etc' });
    expect(illegal.text).toContain('没删成');

    const missing = runSessionCommand({
      workspacePath: workspace,
      currentSessionId: 'x',
      arg: 'rm 20260922-100000-aaaaaa',
    });
    expect(missing.text).toContain('没删成');
    expect(missing.text).not.toBe(illegal.text);
  });

  it('导出不给文件名就打印出来（不往用户工作区写东西）', () => {
    seed('20260922-100000-aaaaaa');

    const { text } = runSessionCommand({
      workspacePath: workspace,
      currentSessionId: 'x',
      arg: 'export 20260922-100000-aaaaaa',
    });

    expect(text).toContain('# 会话记录');
    expect(text).toContain('造一个会话');
    // 工作区里不该凭空多出文件
    expect(readdirNames(workspace)).toEqual([]);
  });

  it('给了文件名就写到工作区里，并回一句落在哪', () => {
    seed('20260922-100000-aaaaaa');

    const { text } = runSessionCommand({
      workspacePath: workspace,
      currentSessionId: 'x',
      arg: 'export 20260922-100000-aaaaaa trace.md',
    });

    expect(text).toContain('已导出');
    expect(readFileSync(join(workspace, 'trace.md'), 'utf8')).toContain('# 会话记录');
  });

  it('导出不存在的会话时拒绝，而不是给一份空文件', () => {
    const { text } = runSessionCommand({
      workspacePath: workspace,
      currentSessionId: 'x',
      arg: 'export 20260922-100000-aaaaaa',
    });

    expect(text).toContain('✗');
    expect(text).not.toContain('# 会话记录');
  });
});

function readdirNames(dir: string): string[] {
  // 单独写一个：测试要自己看得见「工作区目录里到底有什么」
  return readdirSync(dir);
}
