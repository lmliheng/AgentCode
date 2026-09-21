// src/test/persistence/replay.test.ts
//
// 覆盖由事件流重放会话历史：
//   - run 的边界由 task_started 表达，会话跨 run
//   - 未知类型 / 损坏载荷只计数不抛错（恢复的价值是「尽量接上」而不是严格拒绝）
//   - 计划缺失时兜底，不让整段历史作废
//   - stopped 的汇总与重放结果互为校验

import { describe, it, expect } from 'vitest';

import { replaySession } from '../../persistence/replay.js';
import type { SessionEventType, StoredSessionEvent } from '../../persistence/events.js';
import type { ModelDecision } from '../../types/ReAct.js';

const CONTEXT = { sessionId: '20260922-100000-aaaaaa', workspaceRoot: 'C:/ws' };

function event(
  seq: number,
  type: SessionEventType,
  payload: unknown,
  ts = 1000 + seq,
): StoredSessionEvent {
  return { v: 1, seq, ts, type, payload };
}

function taskStarted(seq: number, taskId: string, description: string): StoredSessionEvent {
  return event(seq, 'task_started', {
    taskId,
    taskDescription: description,
    startTime: 1000 + seq,
  });
}

const readFileAction: ModelDecision = {
  type: 'Action',
  tool: 'read_file',
  params: { path: 'a.txt' },
  thought: '先读文件',
};

const finalDecision: ModelDecision = { type: 'Final', answer: '做完了' };

function observationOf(tool: string): unknown {
  return {
    observation: {
      action: { type: 'Action', tool, params: {} },
      result: { success: true, data: { ok: true }, error: '' },
      timestamp: 1234,
    },
  };
}

function plannedPlan(): unknown {
  return {
    plan: {
      originalGoal: '任务一',
      currentStepIndex: 0,
      version: 1,
      steps: [
        { id: 'step-1', description: '读文件', status: 'pending', dependsOn: [], completionCriteria: '读到' },
      ],
    },
  };
}

function stoppedPayload(iterationCount: number): unknown {
  return {
    stopReason: { type: 'task_completed' },
    tokenUsage: { promptTokens: 1, completionTokens: 2, totalTokens: 3, complete: true },
    iterationCount,
    toolCallCount: 1,
    fileChanges: [],
  };
}

describe('重放一次完整的 run', () => {
  it('决策、观察、计划与停止原因都被还原', () => {
    const restored = replaySession(
      [
        taskStarted(1, 'task-1', '任务一'),
        event(2, 'plan_updated', plannedPlan()),
        event(3, 'decision', { decision: readFileAction }),
        event(4, 'observation', observationOf('read_file')),
        event(5, 'decision', { decision: finalDecision }),
        event(6, 'stopped', stoppedPayload(2)),
      ],
      CONTEXT,
    );

    expect(restored.runs).toHaveLength(1);
    const run = restored.runs[0]!;

    expect(run.taskId).toBe('task-1');
    expect(run.taskDescription).toBe('任务一');
    expect(run.decisions).toHaveLength(2);
    expect(run.observations).toHaveLength(1);
    expect(run.plan.steps).toHaveLength(1);
    expect(run.stopReason).toEqual({ type: 'task_completed' });

    // 汇总与重放自洽：iterationCount 与决策数一致
    expect(restored.stats.summaryMismatches).toBe(0);
    expect(restored.stats.applied).toBe(6);
  });

  it('第二个 task_started 开启新 run，两个 run 各自独立', () => {
    const restored = replaySession(
      [
        taskStarted(1, 'task-1', '第一个任务'),
        event(2, 'decision', { decision: readFileAction }),
        event(3, 'observation', observationOf('read_file')),
        event(4, 'stopped', stoppedPayload(1)),
        // 恢复之后用户又发了一条：同一个会话里的第二次 run
        taskStarted(5, 'task-2', '第二个任务'),
        event(6, 'decision', { decision: finalDecision }),
        event(7, 'stopped', stoppedPayload(1)),
      ],
      CONTEXT,
    );

    expect(restored.runs.map((run) => run.taskDescription)).toEqual(['第一个任务', '第二个任务']);
    expect(restored.runs[0]!.decisions).toHaveLength(1);
    expect(restored.runs[1]!.decisions).toHaveLength(1);
    // 观察只属于第一个 run：它带走了那条 read_file 的结果
    expect(restored.runs[0]!.observations).toHaveLength(1);
    expect(restored.runs[1]!.observations).toHaveLength(0);
  });
});

describe('容错', () => {
  it('未知事件类型被跳过并计数，不影响其它事件', () => {
    const restored = replaySession(
      [
        taskStarted(1, 'task-1', '任务一'),
        event(2, 'session_metrics' as SessionEventType, { whatever: true }),
        event(3, 'decision', { decision: finalDecision }),
      ],
      CONTEXT,
    );

    expect(restored.runs[0]!.decisions).toHaveLength(1);
    expect(restored.stats.skippedUnknownType).toBe(1);
    expect(restored.stats.skippedMalformed).toBe(0);
  });

  it('载荷损坏只计数，不抛错', () => {
    const restored = replaySession(
      [
        taskStarted(1, 'task-1', '任务一'),
        event(2, 'decision', {}),                       // 缺 decision
        event(3, 'observation', { observation: {} }),   // 缺 action / result
        event(4, 'plan_updated', { plan: { steps: [] } }),
        event(5, 'decision', { decision: finalDecision }),
      ],
      CONTEXT,
    );

    expect(restored.runs[0]!.decisions).toHaveLength(1);
    expect(restored.stats.skippedMalformed).toBe(3);
  });

  it('task_started 之前的事件算孤儿，不会被塞进任何 run', () => {
    const restored = replaySession(
      [
        event(1, 'decision', { decision: finalDecision }),
        taskStarted(2, 'task-1', '任务一'),
      ],
      CONTEXT,
    );

    expect(restored.runs[0]!.decisions).toHaveLength(0);
    expect(restored.stats.orphaned).toBe(1);
  });

  it('计划事件缺失时用只含目标的空计划兜底', () => {
    const restored = replaySession(
      [taskStarted(1, 'task-1', '任务一'), event(2, 'decision', { decision: finalDecision })],
      CONTEXT,
    );

    expect(restored.runs[0]!.plan.originalGoal).toBe('任务一');
    expect(restored.runs[0]!.plan.steps).toEqual([]);
    expect(restored.runs[0]!.decisions).toHaveLength(1);
  });

  it('空事件流得到空历史，不抛错', () => {
    const restored = replaySession([], CONTEXT);

    expect(restored.runs).toEqual([]);
    expect(restored.stats.total).toBe(0);
  });
});

describe('汇总与重放互为校验', () => {
  it('iterationCount 与决策数不符时被记录为不一致', () => {
    const restored = replaySession(
      [
        taskStarted(1, 'task-1', '任务一'),
        event(2, 'decision', { decision: finalDecision }),
        // 汇总声称跑了 5 轮，但日志里只有 1 条决策
        event(3, 'stopped', stoppedPayload(5)),
      ],
      CONTEXT,
    );

    expect(restored.stats.summaryMismatches).toBe(1);
  });
});
