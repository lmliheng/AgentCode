// src/test/runtime/session-persistence.test.ts
//
// 覆盖运行时与会话事件流的接线：
//   - 状态迁移点按顺序交出事件（决策先于观察、结束时补汇总与验收）
//   - 落盘 → 重放 → 作为 priorRuns 交回运行时，历史成为同一段对话
//   - 崩溃留下的悬挂 tool_call 在恢复时被修补
//   - 事件写失败不中断运行，但会留下可查的降级状态

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AgentRuntime } from '../../runtime/agent.runtime.js';
import { ReadFileTool } from '../../tools/read_file.js';
import { SessionStore } from '../../persistence/session-store.js';
import { resolveResumeTarget } from '../../persistence/resume.js';

import { createTestWorkspace, cleanupTestWorkspace, initialPlanDecision } from '../setup.js';
import type { SessionEventInput } from '../../persistence/events.js';
import type {
  AgentProvider,
  AgentProviderConfig,
  ModelResponse,
  ToolDefinition,
} from '../../types/AgentProvider.js';
import type { ChatMessage } from '../../types/Message.js';
import type { ModelDecision } from '../../types/ReAct.js';

/** 记录每次请求收到的消息，并按脚本逐轮返回决策 */
class ScriptedProvider implements AgentProvider {
  readonly name = 'scripted';
  config: AgentProviderConfig = { modelName: 'scripted', temperature: 0, maxTokens: 100 };
  readonly seen: Array<{ messages: ChatMessage[]; tools: ToolDefinition[] }> = [];

  private readonly script: ModelDecision[];
  private index = 0;

  constructor(script: ModelDecision[]) {
    // 脚本第一位留给规划轮
    this.script = [initialPlanDecision(), ...script];
  }

  updateConfig(): void {
    // 测试用，无需实现
  }

  async decide(messages: ChatMessage[], tools: ToolDefinition[] = []): Promise<ModelResponse> {
    this.seen.push({ messages, tools });
    const decision = this.script[this.index] ?? { type: 'Final', answer: '结束' };
    this.index += 1;
    return { decision, rawContent: '' };
  }
}

/** 第一次进入 ReAct 循环时真正送出去的消息（第 0 次是规划轮） */
function firstLoopMessages(provider: ScriptedProvider): ChatMessage[] {
  const call = provider.seen[1];
  if (!call) throw new Error('运行没有进入 ReAct 循环');
  return call.messages;
}

function makeRuntime(
  provider: AgentProvider,
  workspacePath: string,
  extra: Record<string, unknown> = {},
): AgentRuntime {
  return new AgentRuntime(provider, [new ReadFileTool()], {
    workspacePath,
    maxIterations: 10,
    ...extra,
  });
}

let workspace = '';
let sessionsRoot = '';

beforeEach(() => {
  workspace = createTestWorkspace({ 'a.txt': 'hello' });
  sessionsRoot = mkdtempSync(join(tmpdir(), 'coding-agent-sessions-'));
});

afterEach(() => {
  cleanupTestWorkspace(workspace);
  rmSync(sessionsRoot, { recursive: true, force: true });
});

describe('事件在状态迁移点上被交出', () => {
  it('按 task_started → plan → 决策/观察 → stopped → verification 的顺序产出', async () => {
    const provider = new ScriptedProvider([
      { type: 'Action', tool: 'read_file', params: { path: 'a.txt' }, thought: '读文件' },
      { type: 'Final', answer: '完成' },
    ]);

    const events: SessionEventInput[] = [];
    const runtime = makeRuntime(provider, workspace, {
      onSessionEvent: (event: SessionEventInput) => events.push(event),
    });

    await runtime.run('读一下 a.txt');

    expect(events.map((event) => event.type)).toEqual([
      'task_started',
      'plan_updated',
      'decision',
      'observation',
      'decision',
      'stopped',
      'verification',
    ]);
  });

  it('决策事件带上该轮的上下文大小，且决策先于观察', async () => {
    const provider = new ScriptedProvider([
      { type: 'Action', tool: 'read_file', params: { path: 'a.txt' }, thought: '读文件' },
      { type: 'Final', answer: '完成' },
    ]);

    const events: SessionEventInput[] = [];
    const runtime = makeRuntime(provider, workspace, {
      onSessionEvent: (event: SessionEventInput) => events.push(event),
    });

    await runtime.run('读一下 a.txt');

    const decisionIndex = events.findIndex((event) => event.type === 'decision');
    const observationIndex = events.findIndex((event) => event.type === 'observation');
    expect(decisionIndex).toBeGreaterThan(-1);
    expect(observationIndex).toBeGreaterThan(decisionIndex);

    const decision = events[decisionIndex]!.payload as { contextSize?: { tokens: number | null } };
    expect(decision.contextSize).toBeDefined();
  });

  it('不配置事件出口时行为不变，也不报降级', async () => {
    const provider = new ScriptedProvider([{ type: 'Final', answer: '完成' }]);
    const runtime = makeRuntime(provider, workspace);

    const result = await runtime.run('什么也不做');

    expect(result.state.stopReason).toEqual({ type: 'task_completed' });
    expect(runtime.getPersistenceStatus()).toEqual({ degraded: false, error: null });
  });
});

describe('落盘 → 重放 → 接着聊', () => {
  it('恢复后的上下文包含上一段对话的工具调用与结果', async () => {
    const store = new SessionStore(workspace, '20260922-100000-aaaaaa', { root: sessionsRoot });

    const first = new ScriptedProvider([
      { type: 'Action', tool: 'read_file', params: { path: 'a.txt' }, thought: '读文件' },
      { type: 'Final', answer: '第一段结束' },
    ]);
    await makeRuntime(first, workspace, {
      onSessionEvent: (event: SessionEventInput) => {
        store.append(event);
      },
    }).run('先读一遍 a.txt');

    // 恢复目标：不带参数时取当前工作区最近活跃的会话
    const resolution = resolveResumeTarget(workspace, undefined, { root: sessionsRoot });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;

    expect(resolution.target.sessionId).toBe('20260922-100000-aaaaaa');
    expect(resolution.target.runs).toHaveLength(1);
    expect(resolution.target.runs[0]!.decisions).toHaveLength(2);

    const resumed = new ScriptedProvider([{ type: 'Final', answer: '接着聊' }]);
    const resumedRuntime = makeRuntime(resumed, workspace, {
      priorRuns: resolution.target.runs,
      onSessionEvent: (event: SessionEventInput) => {
        store.append(event);
      },
    });
    await resumedRuntime.run('再看看那个文件');

    const messages = firstLoopMessages(resumed);

    // 历史在前、本轮目标在后 —— 这是「接着聊」的全部含义
    expect(messages[0]!.role).toBe('system');
    expect(messages[1]!.role).toBe('user');
    expect(messages[1]!.content).toContain('先读一遍 a.txt');

    // 上一轮的助手工具调用与工具结果都还在
    const toolCallMessage = messages.find((message) => message.role === 'assistant' && message.tool_calls);
    expect(toolCallMessage).toBeDefined();

    const toolMessage = messages.find((message) => message.role === 'tool');
    expect(toolMessage?.content).toContain('hello');

    // 本轮目标与收尾提示
    const goals = messages.filter((message) => message.role === 'user');
    expect(goals.some((message) => message.content.includes('再看看那个文件'))).toBe(true);
    expect(messages[messages.length - 1]!.content).toContain('请根据以上信息');

    // 同一个会话的两个 run 连在一起，seq 跨 run 连续
    expect(store.readEvents().map((event) => event.seq)).toEqual(
      Array.from({ length: store.readEvents().length }, (_, i) => i + 1),
    );
  });

  it('崩溃留下的悬挂 tool_call 在恢复时被修补掉', async () => {
    const store = new SessionStore(workspace, '20260922-100000-aaaaaa', { root: sessionsRoot });
    store.append({
      type: 'task_started',
      payload: { taskId: 'task-1', taskDescription: '上次中断的任务', startTime: 1000 },
      ts: 1000,
    });
    // 只有决策、没有观察：模型说要读文件，进程在工具返回前被杀
    store.append({
      type: 'decision',
      payload: {
        decision: { type: 'Action', tool: 'read_file', params: { path: 'a.txt' }, thought: '' },
      },
      ts: 1001,
    });

    const resolution = resolveResumeTarget(workspace, undefined, { root: sessionsRoot });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;

    expect(resolution.target.runs[0]!.decisions).toHaveLength(1);
    expect(resolution.target.runs[0]!.observations).toHaveLength(0);

    const provider = new ScriptedProvider([{ type: 'Final', answer: '接着来' }]);
    await makeRuntime(provider, workspace, {
      priorRuns: resolution.target.runs,
    }).run('继续上次的任务');

    const messages = firstLoopMessages(provider);

    // 没有结果消息的助手调用不能留在序列里，否则下一次请求是非法的
    expect(
      messages.some((message) => message.role === 'assistant' && message.tool_calls?.length),
    ).toBe(false);
    // 历史的目标行仍然保留：丢掉的是那一次未完成的调用，不是整段历史
    expect(
      messages.some(
        (message) => message.role === 'user' && message.content.includes('上次中断的任务'),
      ),
    ).toBe(true);
  });
});

describe('事件写失败', () => {
  it('不中断运行，但降级状态可查', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const provider = new ScriptedProvider([{ type: 'Final', answer: '完成' }]);
      const runtime = makeRuntime(provider, workspace, {
        onSessionEvent: () => {
          throw new Error('磁盘满');
        },
      });

      const result = await runtime.run('什么也不做');

      // 任务照常跑完：一次写盘失败不该打断正在进行的活儿
      expect(result.state.stopReason).toEqual({ type: 'task_completed' });

      const status = runtime.getPersistenceStatus();
      expect(status.degraded).toBe(true);
      expect(status.error).toContain('磁盘满');

      // 不能静默：出口失败要告警一次
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
