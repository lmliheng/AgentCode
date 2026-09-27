// src/persistence/session-export.ts
//
// 把一段会话事件流渲染成人读的 Markdown。
//
// 为什么要有这个：排查「这一轮为什么跑砸」时，唯一完整的证据是事件流，而事件流是
// 给人看的却不好读（JSONL，一条大决策能占满屏幕）。原来只能手动把 trace 贴进文档
// （见 packages/cli/run_test 里那些手贴的 log），贴的时候还会顺手删掉不想要的部分 ——
// 于是「基线」和「bug 报告」对不上号了。
//
// 这里刻意读**原始事件**而不是重放后的 state：导出是取证，取证的底线是忠实。
// 重放会丢掉坏行与孤儿事件，而「哪些行坏了」本身就是排查时要看的东西。

import type { StoredSessionEvent } from './events.js';
import { isKnownEventType } from './events.js';
import type {
    ApprovalPayload,
    DecisionPayload,
    ObservationPayload,
    StoppedPayload,
    TaskStartedPayload,
    VerificationPayload,
    PlanUpdatedPayload,
} from './events.js';
import type { Observation, ModelDecision, PlanState, StopReason } from '../types/ReAct.js';

/** 单条观察导出时的正文上限：导出是给人读的，不是搬运动辄几 MB 的原始输出 */
const MAX_OBSERVATION_CHARS = 2000;
/** 单条模型决策的 thought 上限 */
const MAX_THOUGHT_CHARS = 1500;

export interface ExportSessionOptions {
    /** 单条观察正文的字符上限，默认 2000 */
    maxObservationChars?: number;
    /** 时钟渲染：默认按本地时间输出 ISO 片段 */
    formatTime?: (ts: number) => string;
}

/**
 * 渲染一段会话事件流。
 *
 * 头部给汇总（时间范围、事件数、停止原因、用量），正文按事件顺序逐条展开 ——
 * 顺序是事件流唯一自带的结构，重排它就没有可信的因果顺序了。
 */
export function renderSessionMarkdown(
    events: readonly StoredSessionEvent[],
    options: ExportSessionOptions = {},
): string {
    const formatTime = options.formatTime ?? defaultFormatTime;
    const lines: string[] = [];

    lines.push('# 会话记录');
    lines.push('');
    lines.push(...renderSummary(events, formatTime));
    lines.push('');
    lines.push('## 事件流');
    lines.push('');

    if (events.length === 0) {
        lines.push('（这个会话没有任何事件）');
        return `${lines.join('\n')}\n`;
    }

    for (const event of events) {
        lines.push(`### #${event.seq} ${event.type} — ${formatTime(event.ts)}`);
        lines.push('');
        lines.push(...renderEventBody(event, options.maxObservationChars ?? MAX_OBSERVATION_CHARS));
        lines.push('');
    }

    // 末尾统一一个换行：拼接进别的文档时不会与下一段粘在一起
    return `${lines.join('\n').trimEnd()}\n`;
}

function renderSummary(
    events: readonly StoredSessionEvent[],
    formatTime: (ts: number) => string,
): string[] {
    const first = events[0];
    const last = events[events.length - 1];
    const stops = events.filter(event => event.type === 'stopped');
    const unknown = events.filter(event => !isKnownEventType(event.type));

    const lines = [
        `- 事件数：${events.length}（seq ${first?.seq ?? 0}–${last?.seq ?? 0}）`,
        `- 时间：${first ? formatTime(first.ts) : '—'} → ${last ? formatTime(last.ts) : '—'}`,
    ];

    if (stops.length > 0) {
        const reasons = stops
            .map(event => describeStopReason((event.payload as { stopReason?: StopReason }).stopReason))
            .join('、');
        lines.push(`- 停止原因：${reasons}`);
    }

    // 未知类型单独点出来：它意味着这份日志来自更（或更不）新的版本，
    // 阅读时对「缺了点什么」要有预期
    if (unknown.length > 0) {
        const types = [...new Set(unknown.map(event => event.type))].join('、');
        lines.push(`- 未知事件类型：${unknown.length} 条（${types}）`);
    }

    return lines;
}

function renderEventBody(event: StoredSessionEvent, maxObservationChars: number): string[] {
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
        case 'task_started': {
            const started = payload as unknown as TaskStartedPayload;
            return [`任务：${started.taskDescription}`];
        }
        case 'plan_updated': {
            return renderPlan((payload as unknown as PlanUpdatedPayload).plan);
        }
        case 'decision': {
            const decisionPayload = payload as unknown as DecisionPayload;
            return renderDecision(decisionPayload.decision);
        }
        case 'observation': {
            return renderObservation((payload as unknown as ObservationPayload).observation, maxObservationChars);
        }
        case 'approval': {
            const { approval } = payload as unknown as ApprovalPayload;
            const mark = approval.decision === 'approve' ? '批准' : '拒绝';
            return [`审批：${mark} [${approval.source}] ${approval.summary}`];
        }
        case 'context_folded': {
            const folded = payload as unknown as { keepRuns: number; keepObservations: number; reason: string };
            return [`上下文折叠：保留最近 ${folded.keepRuns} 个历史 run / ${folded.keepObservations} 条观察（${folded.reason}）`];
        }
        case 'stopped': {
            return renderStopped(payload as unknown as StoppedPayload);
        }
        case 'verification': {
            const { verification } = payload as unknown as VerificationPayload;
            return [
                `验收：${verification.passed ? '通过' : '不通过'}`,
                `判据：${verification.verificationStatus}`,
                '',
                '```text',
                clip(verification.details, 1500),
                '```',
            ];
        }
        default: {
            // 未知类型：解析阶段特意放行（见 events.ts 的说明），导出时也不能当它不存在 ——
            // 「这份日志来自另一个版本」正是阅读时要看出来的事。给一段 JSON 兜底。
            return ['```json', safeStringify(payload), '```'];
        }
    }
}

function renderStopped(stopped: StoppedPayload): string[] {
    return [
        `停止：${describeStopReason(stopped.stopReason)}`,
        `轮次：${stopped.iterationCount} 次决策 / 工具 ${stopped.toolCallCount} 次`,
        `用量：${stopped.tokenUsage.totalTokens} tokens` +
            (stopped.tokenUsage.complete === false ? '（统计不完整）' : ''),
        `文件变更：${stopped.fileChanges.length} 处`,
    ];
}

function renderPlan(plan: PlanState | undefined): string[] {
    if (!plan) return ['（计划缺失）'];

    const lines = [`计划 v${plan.version}（目标：${plan.originalGoal}）`, ''];
    plan.steps.forEach((step, index) => {
        const mark = step.status === 'completed' ? 'x' : ' ';
        lines.push(`- [${mark}] ${index + 1}. ${step.description}`);
        lines.push(`      完成判据：${step.completionCriteria}`);
    });
    return lines;
}

function renderDecision(decision: ModelDecision | undefined): string[] {
    if (!decision) return ['（决策缺失）'];

    const lines: string[] = [];
    switch (decision.type) {
        case 'Action': {
            lines.push(`思考：${clip(decision.thought ?? '', MAX_THOUGHT_CHARS)}`);
            lines.push(`动作：${decision.tool}(${safeStringify(decision.params ?? {})})`);
            break;
        }
        case 'BatchAction': {
            lines.push(`批量动作 ${decision.actions.length} 个：`);
            decision.actions.forEach((action, index) => {
                lines.push(`  ${index + 1}. ${action.tool}(${safeStringify(action.params ?? {})})`);
            });
            break;
        }
        case 'Replan': {
            lines.push(`重新规划：${decision.reason}`);
            decision.newPlan.forEach((step, index) => {
                lines.push(`  ${index + 1}. ${step.description}`);
            });
            break;
        }
        case 'Final': {
            lines.push(`最终答复：${decision.answer}`);
            break;
        }
    }
    return lines;
}

function renderObservation(observation: Observation | undefined, maxChars: number): string[] {
    if (!observation) return ['（观察缺失）'];

    const { success, error } = observation.result;
    const lines = [
        `工具：${observation.action.tool}`,
        `结果：${success ? '成功' : `失败（${error || '未记录原因'}）`}`,
    ];

    // 送出量：真正的输入开销在这里，不在 data 的大小上（见 ObservationDelivery）
    if (observation.delivery) {
        const { rawChars, deliveredChars, truncated } = observation.delivery;
        lines.push(`送出量：${deliveredChars} / ${rawChars} 字符${truncated ? '（已截断）' : ''}`);
    }

    if (observation.result.display !== undefined) {
        lines.push(`摘要：${observation.result.display}`);
    }

    if (observation.result.data !== null && observation.result.data !== undefined) {
        const rendered = safeStringify(observation.result.data);
        lines.push('```json');
        lines.push(clip(rendered, maxChars));
        lines.push('```');
    }

    return lines;
}

function describeStopReason(reason: StopReason | undefined): string {
    if (!reason) return '（未记录）';
    switch (reason.type) {
        case 'task_completed': return '任务完成';
        case 'max_iterations': return `达到迭代上限（${reason.limit}）`;
        case 'max_tool_calls': return `达到工具调用上限（${reason.limit}）`;
        case 'max_tokens': return `达到 token 上限（${reason.limit}）`;
        case 'max_file_changes': return `达到文件变更上限（${reason.limit}）`;
        case 'timeout': return `超时（${reason.durationMs}ms）`;
        case 'no_progress': return `无进展（${reason.tool} 重复 ${reason.repeats} 次）`;
        case 'user_interrupted': return '用户打断';
        case 'error': return `错误：${reason.message}`;
    }
}

function clip(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}\n…（省略 ${text.length - maxChars} 字符）`;
}

/** JSON.stringify 会在循环引用上抛异常，而导出不该被一条坏数据整个带走 */
function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2) ?? String(value);
    } catch {
        return '（此值无法序列化）';
    }
}

function defaultFormatTime(ts: number): string {
    const date = new Date(ts);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
