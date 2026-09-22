
//
// 会话数据的落盘位置。
//
// 布局：
//   <root>/ws-<workspaceHash>/                        按工作区分区
//     index.json                                      会话清单快照（派生，可删）
//     sessions/<sessionId>/meta.json                  会话头（一次写入）
//     sessions/<sessionId>/events.jsonl               事件流（append-only）
//     sessions/<sessionId>/blobs/                     预留：大对象外置
//
// 放在**用户级目录**而不是工作区内：工作区内的文件会被 git_operation 暂存、
// 被 search_code / read_directory 搜到，会话数据不该出现在这些工具的结果里
// （工具输出落盘在 output-budget.ts 里已因为同一理由放到工作区之外）。
// 也不放系统临时目录：长驻会话要跨重启存活，而临时目录会被清理。

import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * 覆盖会话根目录的环境变量。
 *
 * 它有两个正当用途：测试要写到临时目录而不是真实的家目录；用户想把会话
 * 放到别的盘。生产路径本身仍然是「家目录下的固定位置」。
 */
export const SESSIONS_ROOT_ENV = 'AGENTCODE_SESSIONS_ROOT';

/** 会话 ID 形状：`YYYYMMDD-HHMMSS-<6位十六进制>` */
export const SESSION_ID_PATTERN = /^\d{8}-\d{6}-[0-9a-f]{6}$/;

/**
 * 规范化工作区路径。
 *
 * 只做一件事，但非做不可：**统一 Windows 盘符大小写**。同一目录写成 `c:\x`
 * 与 `C:\x` 指向同一处，但字符串不同 —— 而分区目录名是对字符串做哈希得来的，
 * 两种写法会落到两个分区，表现为「会话无故消失」。
 *
 * 这与本机已知的 vitest 小写盘符问题同源：Windows 会把同一路径的不同大小写
 * 当成不同标识。`resolve` 负责消掉相对路径与尾部分隔符，盘符大小写要自己收。
 */
export function normalizeWorkspaceRoot(raw: string): string {
  const resolved = resolve(raw);
  return resolved.replace(/^([a-z]):/, (_, drive: string) => `${drive.toUpperCase()}:`);
}

/** 工作区分区名。取规范化路径的 sha1 前 12 位 */
export function workspaceHash(raw: string): string {
  const digest = createHash('sha1').update(normalizeWorkspaceRoot(raw)).digest('hex');
  return `ws-${digest.slice(0, 12)}`;
}

/** 会话根目录：家目录下的固定位置，可用环境变量覆盖 */
export function sessionsRoot(override?: string): string {
  return override ?? process.env[SESSIONS_ROOT_ENV] ?? join(homedir(), '.agentcode', 'sessions');
}

/** 某个工作区的会话分区目录 */
export function workspaceSessionsDir(workspaceRoot: string, root?: string): string {
  return join(sessionsRoot(root), workspaceHash(workspaceRoot));
}

/** 清单快照文件（派生产物，删掉不影响恢复） */
export function workspaceIndexFile(workspaceRoot: string, root?: string): string {
  return join(workspaceSessionsDir(workspaceRoot, root), 'index.json');
}

/** 所有会话的父目录 */
export function sessionsCollectionDir(workspaceRoot: string, root?: string): string {
  return join(workspaceSessionsDir(workspaceRoot, root), 'sessions');
}

export function sessionDir(workspaceRoot: string, sessionId: string, root?: string): string {
  return join(sessionsCollectionDir(workspaceRoot, root), sessionId);
}

export function sessionMetaFile(workspaceRoot: string, sessionId: string, root?: string): string {
  return join(sessionDir(workspaceRoot, sessionId, root), 'meta.json');
}

export function sessionEventsFile(workspaceRoot: string, sessionId: string, root?: string): string {
  return join(sessionDir(workspaceRoot, sessionId, root), 'events.jsonl');
}

export function sessionBlobsDir(workspaceRoot: string, sessionId: string, root?: string): string {
  return join(sessionDir(workspaceRoot, sessionId, root), 'blobs');
}

/**
 * 生成会话 ID。
 *
 * 时间戳在前是为了**可排序**：列会话时按目录名排就是按创建时间排，不必打开
 * 任何文件。随机后缀避免同一秒内创建两个会话时撞名（撞名的代价是两个会话
 * 混在一个事件流里）。
 */
export function makeSessionId(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

export function isSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value);
}
