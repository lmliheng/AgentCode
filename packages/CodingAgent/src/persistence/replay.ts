// src/persistence/replay.ts
//
// 由事件流重放出会话历史。
//
// 重放的产物是「每次 run 的决策 + 观察」，而不是 messages：messages 由运行时
// 从这些事实每轮派生（`AgentRuntime.buildContextMessages`）。这里若顺手把
// messages 也存下来，就会出现两份会各自漂移的历史。

import type {
  ModelDecision,
  Observation,
  PlanState,
  StopReason,
  TaskVerificationResult,
} from '../types/ReAct.js';
import type { PriorRun } from '../types/Runtime.js';
import { isKnownEventType, type StoredSessionEvent } from './events.js';

/** 一次 run 的重放结果。`taskId`/`startTime` 只用于审计与核对，不参与消息派生 */
export interface RestoredRun extends PriorRun {
  taskId: string;
  startTime: number;
  stopReason?: StopReason;
  verification?: TaskVerificationResult;
}

export interface SessionReplayStats {
  /** 读到的事件行总数 */
  total: number;
  /** 真正被采纳的事件数 */
  applied: number;
  /** 类型不在本版本词汇表里（前向兼容：跳过，不当成坏行） */
  skippedUnknownType: number;
  /** 类型已知但载荷不可解析 */
  skippedMalformed: number;
  /** 不属于任何 run 的事件（出现在 task_started 之前） */
  orphaned: number;
  /** `stopped` 事件的汇总与重放结果不一致的 run 数（0 表示日志与重放自洽） */
  summaryMismatches: number;
}

export interface RestoredSession {
  sessionId: string;
  workspaceRoot: string;
  runs: RestoredRun[];
  stats: SessionReplayStats;
}

/**
 * 重放一个会话的全部事件。
 *
 * 容错策略与解析层一致：**能读多少读多少**。未知类型、载荷损坏都只计数不抛错 ——
 * 恢复历史的价值在于「尽量接上上一次」，而不是「严格校验后拒绝恢复」。
 */
export function replaySession(
  events: readonly StoredSessionEvent[],
  context: { sessionId: string; workspaceRoot: string },
): RestoredSession {
  const runs: RestoredRun[] = [];
  const stats: SessionReplayStats = {
    total: events.length,
    applied: 0,
    skippedUnknownType: 0,
    skippedMalformed: 0,
    orphaned: 0,
    summaryMismatches: 0,
  };

  let current: RestoredRun | null = null;

  for (const event of events) {
    if (!isKnownEventType(event.type)) {
      stats.skippedUnknownType += 1;
      continue;
    }

    switch (event.type) {
      case 'task_started': {
        const payload = readTaskStarted(event.payload);
        if (payload === null) {
          stats.skippedMalformed += 1;
          continue;
        }
        runs.push(newRun(payload));
        current = runs[runs.length - 1]!;
        stats.applied += 1;
        break;
      }

      case 'decision': {
        const decision = readDecision(event.payload);
        if (decision === null) {
          stats.skippedMalformed += 1;
          continue;
        }
        if (current === null) {
          stats.orphaned += 1;
          continue;
        }
        current.decisions.push(decision);
        stats.applied += 1;
        break;
      }

      case 'observation': {
        const observation = readObservation(event.payload);
        if (observation === null) {
          stats.skippedMalformed += 1;
          continue;
        }
        if (current === null) {
          stats.orphaned += 1;
          continue;
        }
        current.observations.push(observation);
        stats.applied += 1;
        break;
      }

      case 'plan_updated': {
        const plan = readPlan(event.payload);
        if (plan === null) {
          stats.skippedMalformed += 1;
          continue;
        }
        if (current === null) {
          stats.orphaned += 1;
          continue;
        }
        current.plan = plan;
        stats.applied += 1;
        break;
      }

      case 'stopped': {
        if (current === null) {
          stats.orphaned += 1;
          continue;
        }
        const summary = readStopped(event.payload);
        if (summary.stopReason !== undefined) current.stopReason = summary.stopReason;

        // 汇总与重放结果互为校验：`iterationCount` 应当等于决策条数。
        // 不一致说明日志或重放有一方有 bug —— 不拦恢复，但要能被发现。
        if (
          typeof summary.iterationCount === 'number' &&
          summary.iterationCount !== current.decisions.length
        ) {
          stats.summaryMismatches += 1;
        }
        stats.applied += 1;
        break;
      }

      case 'verification': {
        if (current === null) {
          stats.orphaned += 1;
          continue;
        }
        const verification = readVerification(event.payload);
        if (verification === null) {
          stats.skippedMalformed += 1;
          continue;
        }
        current.verification = verification;
        stats.applied += 1;
        break;
      }
    }
  }

  return { sessionId: context.sessionId, workspaceRoot: context.workspaceRoot, runs, stats };
}

/**
 * 计划尚未落盘时用的占位计划。
 *
 * 计划与任务目标是两条独立的事件（前者可能缺失，例如规划轮就崩了），
 * 缺计划不能让整段历史作废 —— 用只含目标的空计划补上。
 */
function newRun(started: { taskId: string; taskDescription: string; startTime: number }): RestoredRun {
  return {
    taskId: started.taskId,
    taskDescription: started.taskDescription,
    startTime: started.startTime,
    plan: {
      originalGoal: started.taskDescription,
      steps: [],
      currentStepIndex: 0,
      version: 1,
    },
    decisions: [],
    observations: [],
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  return value as Record<string, unknown>;
}

function readTaskStarted(
  payload: unknown,
): { taskId: string; taskDescription: string; startTime: number } | null {
  const record = asRecord(payload);
  if (record === null) return null;
  if (typeof record.taskId !== 'string' || record.taskId === '') return null;
  if (typeof record.taskDescription !== 'string') return null;
  if (typeof record.startTime !== 'number') return null;

  return {
    taskId: record.taskId,
    taskDescription: record.taskDescription,
    startTime: record.startTime,
  };
}

/** 决策只校验到「能看出是哪种决策」为止，进一步的结构交给运行时的既有处理 */
function readDecision(payload: unknown): ModelDecision | null {
  const record = asRecord(payload);
  if (record === null) return null;

  const decision = asRecord(record.decision);
  if (decision === null) return null;
  if (typeof decision.type !== 'string') return null;

  return record.decision as ModelDecision;
}

function readObservation(payload: unknown): Observation | null {
  const record = asRecord(payload);
  if (record === null) return null;

  const observation = asRecord(record.observation);
  if (observation === null) return null;

  const action = asRecord(observation.action);
  const result = asRecord(observation.result);
  if (action === null || result === null) return null;
  if (typeof action.tool !== 'string') return null;

  return record.observation as Observation;
}

function readPlan(payload: unknown): PlanState | null {
  const record = asRecord(payload);
  if (record === null) return null;

  const plan = asRecord(record.plan);
  if (plan === null) return null;
  if (typeof plan.originalGoal !== 'string') return null;
  if (!Array.isArray(plan.steps)) return null;
  if (typeof plan.currentStepIndex !== 'number') return null;
  if (typeof plan.version !== 'number') return null;

  return record.plan as PlanState;
}

function readStopped(payload: unknown): { stopReason?: StopReason; iterationCount?: number } {
  const record = asRecord(payload);
  if (record === null) return {};

  const stopReason = record.stopReason;
  return {
    ...(typeof stopReason === 'object' && stopReason !== null
      ? { stopReason: stopReason as StopReason }
      : {}),
    ...(typeof record.iterationCount === 'number' ? { iterationCount: record.iterationCount } : {}),
  };
}

function readVerification(payload: unknown): TaskVerificationResult | null {
  const record = asRecord(payload);
  if (record === null) return null;

  const verification = asRecord(record.verification);
  if (verification === null) return null;
  if (typeof verification.passed !== 'boolean') return null;

  return record.verification as TaskVerificationResult;
}
