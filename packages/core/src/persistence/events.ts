// src/persistence/events.ts
//
// 会话事件流的行格式。
//
// 事件流是会话的**唯一事实源**：`AgentRunState` 由事件重放得到，messages 再由
// `AgentRunState` 每轮派生。因此这里只放「状态迁移」，不放任何派生视图
// （尤其不放 messages —— 派生视图落盘后会在重建规则变化时与事实源失配）。

import type {
  ContextSizeMetric,
  FileChange,
  ModelDecision,
  Observation,
  PlanState,
  StopReason,
  TaskVerificationResult,
  TokenUsageRecord,
} from '../types/ReAct.js';
import type { TokenUsage } from '../types/AgentProvider.js';

/**
 * 行格式版本。
 *
 * 加字段不升版本；改字段语义或删字段必须升，且旧版本日志仍要能读
 * —— 「上一版应用留下的会话打不开」是不能接受的。
 */
export const SESSION_EVENT_SCHEMA_VERSION = 1;

export type SessionEventType =
  | 'task_started'
  | 'decision'
  | 'observation'
  | 'plan_updated'
  | 'stopped'
  | 'verification';

/** 一次 run 的开始。会话跨 run，run 的边界只由本事件表达（不在目录结构里） */
export interface TaskStartedPayload {
  taskId: string;
  taskDescription: string;
  startTime: number;
}

export interface DecisionPayload {
  decision: ModelDecision;
  /**
   * 该轮的模型用量。度量类不单独成事件 —— 它们只有挂在这一轮上才有解释力，
   * 单列成行反而要多一次「这条度量属于哪一轮」的匹配。
   */
  usage?: TokenUsage;
  /** 该轮结束时的当前上下文大小（口径见 ContextSizeMetric） */
  contextSize?: ContextSizeMetric;
}

export interface ObservationPayload {
  observation: Observation;
}

export interface PlanUpdatedPayload {
  plan: PlanState;
}

export interface StoppedPayload {
  stopReason?: StopReason;
  /** run 结束时的汇总。它与重放结果互为校验：两者不一致说明日志或重放有 bug */
  tokenUsage: TokenUsageRecord;
  iterationCount: number;
  toolCallCount: number;
  fileChanges: FileChange[];
}

export interface VerificationPayload {
  verification: TaskVerificationResult;
}

export interface SessionEventPayloads {
  task_started: TaskStartedPayload;
  decision: DecisionPayload;
  observation: ObservationPayload;
  plan_updated: PlanUpdatedPayload;
  stopped: StoppedPayload;
  verification: VerificationPayload;
}

/** 调用方交出去的事件：`v` / `seq` / `ts` 由存储补齐，不由调用方指定 */
export interface SessionEventInput<T extends SessionEventType = SessionEventType> {
  type: T;
  payload: SessionEventPayloads[T];
  /** 指定时间戳，默认取当前时间。仅测试需要 */
  ts?: number;
}

/**
 * 存储与重放侧的事件形状。
 *
 * `payload` 在这里是 `unknown`：读取来的数据没有类型保证，逐类型的收窄交给
 * 重放函数做，而不是靠解析阶段的断言。
 */
export interface StoredSessionEvent {
  v: number;
  /** 会话内单调递增，从 1 开始 */
  seq: number;
  ts: number;
  type: SessionEventType;
  payload: unknown;
}

export function serializeEvent(event: StoredSessionEvent): string {
  return JSON.stringify(event);
}

/**
 * 解析一行事件。
 *
 * 只校验「行本身能否解释」，**不校验 type 是否是当前已知的类型**：
 * 未知类型必须被接受，否则旧版本代码读到新版本写的日志时会把那行当成坏行 ——
 * 而坏行的语义是「日志到此为止」，等于把后半段会话整个丢掉。
 * 未知类型的处理放在重放阶段（忽略并计数）。
 */
export function parseEvent(line: string): StoredSessionEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }

  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;

  const { v, seq, ts, type } = candidate;
  if (typeof v !== 'number' || !Number.isInteger(v)) return null;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) return null;
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null;
  if (typeof type !== 'string' || type === '') return null;

  return { v, seq, ts, type: type as SessionEventType, payload: candidate.payload };
}

/** 是否是本版本已知的事件类型（重放阶段用，解析阶段不用） */
export function isKnownEventType(type: string): type is SessionEventType {
  return (
    type === 'task_started' ||
    type === 'decision' ||
    type === 'observation' ||
    type === 'plan_updated' ||
    type === 'stopped' ||
    type === 'verification'
  );
}
