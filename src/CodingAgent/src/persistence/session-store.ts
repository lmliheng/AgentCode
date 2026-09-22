

//
// 会话事件流的读写。
//
// 两条规则贯穿本文件：
//
// 1. **事件流是事实源，index.json 只是派生快照。** 恢复路径一律从事件流读，
//    索引可以随时删掉重建；把索引当权威会让「索引落后」变成无声的恢复错会话。
// 2. **坏行即日志结束，不回滚已解析部分。** 进程被杀会留下半行，它之后的内容
//    不可信（正常情况下也不存在）。丢弃已解析的部分反而会把完好的历史一起丢掉。

import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';

import {
  SESSION_EVENT_SCHEMA_VERSION,
  parseEvent,
  serializeEvent,
  type SessionEventInput,
  type SessionEventType,
  type StoredSessionEvent,
} from './events.js';
import {
  isSessionId,
  makeSessionId,
  sessionBlobsDir,
  sessionEventsFile,
  sessionDir,
  sessionMetaFile,
  sessionsCollectionDir,
  workspaceIndexFile,
} from './paths.js';

/** 会话头。一次写入，之后只读 —— 它不参与重放，作用是让会话可被发现与解释 */
export interface SessionMeta {
  sessionId: string;
  createdAt: number;
  /** 创建时的绝对路径原文。分区用规范化路径，人核对要看原文 */
  workspaceRoot: string;
  schemaVersion: number;
}

export interface SessionSummary {
  sessionId: string;
  createdAt: number;
  /** 最后活跃时间：事件流最后一行的 ts（权威口径，不是文件 mtime） */
  lastActiveAt: number;
  bytes: number;
}

/**
 * 路径推导的可选覆盖项。
 *
 * `| undefined` 是显式写的：本仓库开了 `exactOptionalPropertyTypes`，
 * 不写就意味着「可以缺省，但不能显式传 undefined」—— 而这里的每个调用点
 * 都是在转发一个「可能没有」的配置，写成可选不带 undefined 会到处报错。
 */
export interface StoreLocationOptions {
  /** 会话根目录覆盖，默认取 `sessionsRoot()` */
  root?: string | undefined;
}

export interface SessionStoreOptions extends StoreLocationOptions {
  /** 时钟，仅测试注入 */
  now?: (() => number) | undefined;
}

/** 读「最后一个事件」时的尾部窗口。单条事件超过它时会退回整体读取 */
const TAIL_WINDOW_BYTES = 64 * 1024;

/**
 * 单个会话的事件流写入器。
 *
 * 目录与 meta.json **懒创建**：第一条事件真的要写时才建。否则「打开应用又立刻
 * 退出」会留下一堆空会话目录，而「哪些会话是真的」就得靠一条额外的判空规则。
 */
export class SessionStore {
  readonly dir: string;
  readonly eventsFile: string;
  readonly metaFile: string;
  readonly blobsDir: string;

  private prepared = false;
  private seq = 0;

  constructor(
    readonly workspaceRoot: string,
    readonly sessionId: string,
    private readonly options: SessionStoreOptions = {},
  ) {
    this.dir = sessionDir(workspaceRoot, sessionId, options.root);
    this.eventsFile = sessionEventsFile(workspaceRoot, sessionId, options.root);
    this.metaFile = sessionMetaFile(workspaceRoot, sessionId, options.root);
    this.blobsDir = sessionBlobsDir(workspaceRoot, sessionId, options.root);
  }

  /** 打开一个会话：给了 id 就续写它，没给就新开一个 */
  static open(
    workspaceRoot: string,
    sessionId?: string,
    options: SessionStoreOptions = {},
  ): SessionStore {
    const now = options.now ?? Date.now;
    return new SessionStore(
      workspaceRoot,
      sessionId ?? makeSessionId(new Date(now())),
      options,
    );
  }

  /** 追加一条事件并返回补齐后的行。seq 在会话内单调递增（跨 run 连续） */
  append(input: SessionEventInput): StoredSessionEvent {
    this.prepare();

    const event: StoredSessionEvent = {
      v: SESSION_EVENT_SCHEMA_VERSION,
      seq: this.seq + 1,
      ts: input.ts ?? (this.options.now ?? Date.now)(),
      type: input.type,
      payload: input.payload,
    };

    appendFileSync(this.eventsFile, `${serializeEvent(event)}\n`, 'utf8');
    this.seq = event.seq;

    // 清单快照是派生产物：它写失败不能影响事件已经落盘这件事。
    // 所以这里吞掉异常，而不是让调用方以为「这次写入失败了」。
    if (input.type === 'stopped') {
      try {
        rebuildWorkspaceIndex(this.workspaceRoot, { root: this.options.root });
      } catch {
        // 索引可以随时重建，此处静默是刻意的
      }
    }

    return event;
  }

  /** 顺序读取全部事件。遇到坏行即停止 */
  readEvents(): StoredSessionEvent[] {
    return parseEventLines(readTextOrEmpty(this.eventsFile)).events;
  }

  readMeta(): SessionMeta | null {
    return readSessionMeta(this.workspaceRoot, this.sessionId, { root: this.options.root });
  }

  /** 会话摘要。没有任何事件时返回 null（空会话不进列表） */
  summary(): SessionSummary | null {
    const events = this.readEvents();
    if (events.length === 0) return null;

    const meta = this.readMeta();
    return {
      sessionId: this.sessionId,
      createdAt: meta?.createdAt ?? events[0]!.ts,
      lastActiveAt: events[events.length - 1]!.ts,
      bytes: sizeOf(this.eventsFile),
    };
  }

  /**
   * 首次写入前的准备：建目录、写会话头、截掉残行、接上已有 seq。
   *
   * 每一步都只在第一次 append 时做一遍 —— 之后每次 append 只是一次追加。
   */
  private prepare(): void {
    if (this.prepared) return;

    mkdirSync(this.dir, { recursive: true });
    // 预留大对象外置的位置。现在为空目录：把「以后要不要把 observations 外置」
    // 变成填空题而不是一次结构重构。
    mkdirSync(this.blobsDir, { recursive: true });

    this.ensureMeta();

    const content = readTextOrEmpty(this.eventsFile);
    const repaired = dropPartialTail(content);
    if (repaired !== content) {
      writeFileSync(this.eventsFile, repaired, 'utf8');
    }

    const parsed = parseEventLines(repaired);
    this.seq = parsed.events.reduce((max, event) => Math.max(max, event.seq), 0);

    this.prepared = true;
  }

  private ensureMeta(): void {
    if (existsSync(this.metaFile)) return;

    const meta: SessionMeta = {
      sessionId: this.sessionId,
      createdAt: (this.options.now ?? Date.now)(),
      workspaceRoot: this.workspaceRoot,
      schemaVersion: SESSION_EVENT_SCHEMA_VERSION,
    };

    // 'wx'：只在文件不存在时创建。已有会话的创建时间不允许被后来的进程改写。
    try {
      writeFileSync(this.metaFile, `${JSON.stringify(meta, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
    } catch (error) {
      // 另一处已经写了（或权限不足）：前者无害，后者交给 append 的写入去暴露
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

export interface ParsedEventsResult {
  events: StoredSessionEvent[];
  /** 因无法解析而被丢弃的行数（含被当作结束点的坏行） */
  dropped: number;
  /** 是否因坏行提前结束 */
  truncated: boolean;
}

/**
 * 逐行解析事件流。
 *
 * 空行跳过；遇到第一个无法解析的非空行即停止，并把后面全部算作丢弃 ——
 * 那之后的内容按约定不可信。
 */
export function parseEventLines(content: string): ParsedEventsResult {
  const events: StoredSessionEvent[] = [];
  let dropped = 0;
  let truncated = false;

  for (const line of content.split('\n')) {
    if (line === '') continue;

    if (truncated) {
      dropped += 1;
      continue;
    }

    const event = parseEvent(line);
    if (event === null) {
      truncated = true;
      dropped += 1;
      continue;
    }
    events.push(event);
  }

  return { events, dropped, truncated };
}

/**
 * 丢掉末尾未以换行结束的残行。
 *
 * 追加前必须做：否则新事件会粘在那半行后面，那个残行既永远解析不了，
 * 又越长越大。这里的返回值直接覆盖原文件。
 */
export function dropPartialTail(content: string): string {
  if (content === '' || content.endsWith('\n')) return content;
  const cut = content.lastIndexOf('\n');
  return cut === -1 ? '' : content.slice(0, cut + 1);
}

export function readSessionMeta(
  workspaceRoot: string,
  sessionId: string,
  options: StoreLocationOptions = {},
): SessionMeta | null {
  const text = readTextOrEmpty(sessionMetaFile(workspaceRoot, sessionId, options.root));
  if (text.trim() === '') return null;

  try {
    const raw = JSON.parse(text) as Partial<SessionMeta>;
    if (typeof raw.sessionId !== 'string' || typeof raw.createdAt !== 'number') return null;
    return {
      sessionId: raw.sessionId,
      createdAt: raw.createdAt,
      workspaceRoot: typeof raw.workspaceRoot === 'string' ? raw.workspaceRoot : '',
      schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0,
    };
  } catch {
    // 会话头损坏不致命：事件流仍在，恢复照常，只是创建时间要退回第一条事件的时间
    return null;
  }
}

/**
 * 该工作区下的全部会话，按 sessionId 升序（即可按时间先后读）。
 *
 * 只读每个会话的最后一个事件来取最后活跃时间，不整体读取 —— 恢复时要遍历
 * 全部会话挑「最近一个」，整体读放大会慢得没必要。
 */
export function listSessions(
  workspaceRoot: string,
  options: StoreLocationOptions = {},
): SessionSummary[] {
  let entries: string[];
  try {
    entries = readdirSync(sessionsCollectionDir(workspaceRoot, options.root));
  } catch {
    return [];
  }

  const summaries: SessionSummary[] = [];
  for (const entry of entries) {
    // 只认会话 ID 形状的目录：别的文件（如用户手动放的说明）不该被当成会话
    if (!isSessionId(entry)) continue;

    const eventsFile = sessionEventsFile(workspaceRoot, entry, options.root);
    const last = lastEventOf(eventsFile);
    if (last === null) continue;

    const meta = readSessionMeta(workspaceRoot, entry, { root: options.root });
    summaries.push({
      sessionId: entry,
      createdAt: meta?.createdAt ?? last.ts,
      lastActiveAt: last.ts,
      bytes: sizeOf(eventsFile),
    });
  }

  return summaries.sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
}

/**
 * 最近活跃的会话。
 *
 * 平局时取 sessionId 较大者，使同一目录下多次执行得到同一个结果 ——
 * 否则「最近」在平局时是随机的，恢复目标会漂。
 */
export function findMostRecentSession(
  workspaceRoot: string,
  options: StoreLocationOptions = {},
): SessionSummary | null {
  let best: SessionSummary | null = null;

  for (const summary of listSessions(workspaceRoot, options)) {
    if (
      best === null ||
      summary.lastActiveAt > best.lastActiveAt ||
      (summary.lastActiveAt === best.lastActiveAt && summary.sessionId > best.sessionId)
    ) {
      best = summary;
    }
  }

  return best;
}

/**
 * 重建会话清单快照。
 *
 * 它是派生产物，只为人与外部工具提供一份目录；**恢复路径不读它**。
 */
export function rebuildWorkspaceIndex(
  workspaceRoot: string,
  options: StoreLocationOptions & { now?: (() => number) | undefined } = {},
): void {
  const sessions = listSessions(workspaceRoot, options);
  mkdirSync(sessionsCollectionDir(workspaceRoot, options.root), { recursive: true });

  writeFileSync(
    workspaceIndexFile(workspaceRoot, options.root),
    `${JSON.stringify(
      {
        version: SESSION_EVENT_SCHEMA_VERSION,
        generatedAt: (options.now ?? Date.now)(),
        workspaceRoot,
        sessions,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

/** 最后一个可解析的事件。尾部窗口 + 整体读取兜底 */
function lastEventOf(eventsFile: string): StoredSessionEvent | null {
  const fromTail = lastEventFromTail(eventsFile);
  if (fromTail !== undefined) return fromTail;

  const parsed = parseEventLines(readTextOrEmpty(eventsFile));
  return parsed.events.length === 0 ? null : parsed.events[parsed.events.length - 1]!;
}

/**
 * 只读文件尾部来找最后一个事件。
 *
 * 返回 `undefined` 表示「窗口里没有可用信息」（单条事件比窗口还大、或窗口内的
 * 行都不完整），由调用方退回整体读取。返回 `null` 表示文件确实没有事件。
 */
function lastEventFromTail(eventsFile: string): StoredSessionEvent | null | undefined {
  let size: number;
  try {
    size = statSync(eventsFile).size;
  } catch {
    return null;
  }
  if (size === 0) return null;

  const windowBytes = Math.min(size, TAIL_WINDOW_BYTES);
  const fd = openSync(eventsFile, 'r');
  let text: string;
  try {
    const buffer = Buffer.alloc(windowBytes);
    readSync(fd, buffer, 0, windowBytes, size - windowBytes);
    text = buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }

  const lines = text.split('\n');
  // 窗口没覆盖整个文件时，首行可能是半行（起点落在行中间）
  const candidates = windowBytes < size ? lines.slice(1) : lines;

  const lastIndex = lastNonEmptyIndex(candidates, candidates.length - 1);
  if (lastIndex === -1) return null;

  const last = parseEvent(candidates[lastIndex]!);
  if (last) return last;

  // 末尾是被杀进程留下的半行：往前一行找。再找不到就交给整体读取
  const previousIndex = lastNonEmptyIndex(candidates, lastIndex - 1);
  if (previousIndex === -1) return undefined;

  return parseEvent(candidates[previousIndex]!) ?? undefined;
}

function lastNonEmptyIndex(lines: string[], from: number): number {
  for (let i = from; i >= 0; i -= 1) {
    if (lines[i] !== '') return i;
  }
  return -1;
}

function readTextOrEmpty(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function sizeOf(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}
