
//
// 决定「`--resume` 该接到哪个会话」。
//
// 触发方式刻意是显式的：默认开新会话，只有用户明确要求才恢复。自动恢复会把
// 「新任务被灌进旧会话上下文」变成默认行为，而这个默认错了会污染每一次使用。

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { normalizeWorkspaceRoot, sessionDir, sessionsRoot } from './paths.js';
import {
  SessionStore,
  findMostRecentSession,
  listSessions,
  type SessionSummary,
} from './session-store.js';
import { replaySession, type RestoredRun, type SessionReplayStats } from './replay.js';

export type ResumeFailureReason =
  | 'no_sessions'
  | 'session_not_found'
  | 'session_empty'
  | 'workspace_mismatch';

export interface ResumeTarget {
  sessionId: string;
  /** 当前工作区（调用方传入的绝对路径原文） */
  workspaceRoot: string;
  /** 会话记录的创建时工作区。两者规范化后相同，原文可能不同 */
  sessionWorkspace: string;
  createdAt: number;
  lastActiveAt: number;
  /** 按时间顺序的全部历史 run，可直接作为 `priorRuns` 交给运行时 */
  runs: RestoredRun[];
  stats: SessionReplayStats;
}

export type ResumeResolution =
  | { ok: true; target: ResumeTarget }
  | { ok: false; reason: ResumeFailureReason; message: string; available: SessionSummary[] };

export interface ResumeOptions {
  /** 会话根目录覆盖，默认取 `sessionsRoot()` */
  root?: string | undefined;
}

/**
 * 解析恢复目标。
 *
 * `sessionId` 省略时取当前工作区「最近活跃」的会话 —— 口径是事件流最后一行的
 * ts，不是创建时间（3 天前开、1 分钟前刚聊过的会话才是要接的那个），也不是
 * 文件 mtime（拷贝与备份会改它，而且它把「写日志」与「用户活跃」当成等价）。
 */
export function resolveResumeTarget(
  workspaceRoot: string,
  sessionId?: string,
  options: ResumeOptions = {},
): ResumeResolution {
  const available = listSessions(workspaceRoot, options);

  let picked: SessionSummary | null = null;
  let requested: string | undefined;

  if (sessionId !== undefined) {
    requested = sessionId;
    picked = available.find((summary) => summary.sessionId === sessionId) ?? null;

    if (picked === null) {
      return explainMissing(workspaceRoot, sessionId, available, options);
    }
  } else {
    picked = findMostRecentSession(workspaceRoot, options);

    if (picked === null) {
      return {
        ok: false,
        reason: 'no_sessions',
        message: `当前工作区还没有任何会话记录，无法恢复：${workspaceRoot}`,
        available: [],
      };
    }
  }

  const store = new SessionStore(workspaceRoot, picked.sessionId, { root: options.root });
  const meta = store.readMeta();

  // 分区是按规范化路径的哈希切的，正常情况下同分区必然同工作区。仍然核对一次，
  // 因为一旦不符，历史里的相对路径全部失效 —— 静默恢复只会得到一堆无法解释的失败。
  if (meta !== null && meta.workspaceRoot !== '' &&
    normalizeWorkspaceRoot(meta.workspaceRoot) !== normalizeWorkspaceRoot(workspaceRoot)) {
    return {
      ok: false,
      reason: 'workspace_mismatch',
      message:
        `会话 ${picked.sessionId} 属于另一个工作区：${meta.workspaceRoot}。` +
        `工具的相对路径以工作区为锚，换工作区恢复会让历史里的路径全部失效。`,
      available,
    };
  }

  const restored = replaySession(store.readEvents(), {
    sessionId: picked.sessionId,
    workspaceRoot,
  });

  return {
    ok: true,
    target: {
      sessionId: picked.sessionId,
      workspaceRoot,
      sessionWorkspace: meta?.workspaceRoot ?? workspaceRoot,
      createdAt: picked.createdAt,
      lastActiveAt: picked.lastActiveAt,
      runs: restored.runs,
      stats: restored.stats,
    },
  };
}

/**
 * 指定了 sessionId 却找不到时的说明。
 *
 * 先分三种情况：形状不对（打字错）、会话存在但没有可解析的事件、会话在别的
 * 工作区下（这时要指出是哪个工作区）。三种都给不同的说法 —— 恢复失败最怕的
 * 是「找不到」这三个字，用户无从判断是路径错了还是会话真的不在。
 */
function explainMissing(
  workspaceRoot: string,
  sessionId: string,
  available: SessionSummary[],
  options: ResumeOptions,
): ResumeResolution {
  if (!existsSync(sessionDirOf(workspaceRoot, sessionId, options))) {
    const elsewhere = findSessionElsewhere(workspaceRoot, sessionId, options);
    if (elsewhere !== null) {
      return {
        ok: false,
        reason: 'workspace_mismatch',
        message:
          `会话 ${sessionId} 属于另一个工作区：${elsewhere}。` +
          `请在那个工作区下恢复，或改用当前工作区的会话。`,
        available,
      };
    }

    return {
      ok: false,
      reason: 'session_not_found',
      message: `当前工作区找不到会话 ${sessionId}：${workspaceRoot}`,
      available,
    };
  }

  return {
    ok: false,
    reason: 'session_empty',
    message: `会话 ${sessionId} 存在，但事件流里没有可解析的内容，无法从这里接上。`,
    available,
  };
}

function sessionDirOf(workspaceRoot: string, sessionId: string, options: ResumeOptions): string {
  return sessionDir(workspaceRoot, sessionId, options.root);
}

/**
 * 在**其它工作区的分区**里找这个 sessionId。
 *
 * 这是唯一需要跨分区查找的地方，而且只在失败路径上跑：与其报「找不到」，
 * 不如直接说清它属于哪个工作区。命中后从该分区的 meta.json 里读工作区原文。
 */
function findSessionElsewhere(
  workspaceRoot: string,
  sessionId: string,
  options: ResumeOptions,
): string | null {
  const root = sessionsRoot(options.root);

  let partitions: string[];
  try {
    partitions = readdirSync(root);
  } catch {
    return null;
  }

  const selfDir = sessionDir(workspaceRoot, sessionId, options.root);

  for (const partition of partitions) {
    if (!partition.startsWith('ws-')) continue;

    const candidateDir = join(root, partition, 'sessions', sessionId);
    if (candidateDir === selfDir) continue;
    if (!existsSync(candidateDir)) continue;

    const recorded = readRecordedWorkspaceRoot(join(candidateDir, 'meta.json'));
    // meta 读不出来时退回分区名：至少能说出「不在这个工作区」
    return recorded ?? partition;
  }

  return null;
}

/** 从 meta.json 里读创建时的工作区原文。损坏或缺失时返回 null */
function readRecordedWorkspaceRoot(metaFile: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(metaFile, 'utf8')) as { workspaceRoot?: unknown };
    return typeof raw.workspaceRoot === 'string' && raw.workspaceRoot !== ''
      ? raw.workspaceRoot
      : null;
  } catch {
    return null;
  }
}

/** 会话清单的人读格式，用于「找不到时列出可用会话」 */
export function formatSessionList(sessions: readonly SessionSummary[], now: number = Date.now()): string {
  if (sessions.length === 0) return '（当前工作区没有会话）';

  return sessions
    .map((summary) => {
      const active = formatTime(summary.lastActiveAt);
      const age = formatAge(now - summary.lastActiveAt);
      const size = formatBytes(summary.bytes);
      return `- ${summary.sessionId}  最后活跃 ${active}（${age}）  ${size}`;
    })
    .join('\n');
}

function formatTime(ts: number): string {
  const at = new Date(ts);
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}`
  );
}

function formatAge(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
