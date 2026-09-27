// src/context-fold.ts
//
// 上下文折叠：历史只增不减时的唯一出路。
//
// 每轮请求都要重发「system + 全部历史 run + 本轮全部决策与观察」（见
// AgentRuntime.buildContextMessages）。轮数一多，输入量近似按平方增长 ——
// run_test/PRD.md §1.1 记的 340,634 个 prompt token 就是这么来的。
//
// 折叠是**视图层**的变换，不动事实源：观察、决策照常完整落盘，重放出来的历史
// 也照常完整。该省的是「每次请求重发的那一份」，不是「记录下来的那一份」。
//
// 为什么不调模型做摘要：一次摘要就是一次额外的模型调用与一份新的不确定性，
// 而且摘要这段话本身也要在之后每一轮重发。这里做的是确定性的收敛 ——
// 保留最近的原样，更早的换成一行能读出自处与恢复方式的说明。

import type { PriorRun } from './types/Runtime.js';

/** 折叠摘要里保留的头部字符数：工具输出的开头通常是「这是什么」 */
export const FOLD_HEAD_CHARS = 180;
/** 折叠摘要里保留的尾部字符数：错误与统计通常在结尾 */
export const FOLD_TAIL_CHARS = 120;

/** 折叠标记：既是给模型看的说明，也是「这已经是摘要」的判据 */
export const FOLD_MARKER = '[历史已折叠]';

export interface ContextFoldPlan {
    /** 保留原样的最近 run 数，更早的折成一行摘要 */
    keepRuns: number;
    /** 当前 run 里保留原样的最近观察数 */
    keepObservations: number;
    /** 是否真的折掉了东西 */
    folded: boolean;
    /** 人可读的依据（进日志，不进提示词） */
    reason: string;
}

/**
 * 超预算时折多少：按超出比例分档。
 *
 * 阶梯刻意粗糙：精确拟合没有依据（「省下多少 token」无法在折叠前算准），
 * 而每次调整都要保持单调 —— 已折叠的不会因为某一轮变小又被展开，
 * 否则提示词前缀会来回翻动，前缀缓存全部失效。
 */
export function planContextFold(input: {
    estimatedTokens: number;
    budgetTokens: number;
    runCount: number;
    observationCount: number;
}): ContextFoldPlan {
    const { estimatedTokens, budgetTokens, runCount, observationCount } = input;

    const inBudget = (reason: string): ContextFoldPlan => ({
        keepRuns: runCount,
        keepObservations: observationCount,
        folded: false,
        reason,
    });

    if (budgetTokens <= 0) return inBudget('未设上下文预算，不折叠');

    if (estimatedTokens <= budgetTokens) {
        return inBudget(`在预算内（≈${estimatedTokens} / ${budgetTokens} tokens）`);
    }

    const ratio = estimatedTokens / budgetTokens;

    // 第一档先折历史 run：它们离当前任务最远，且整段丢弃不会破坏消息配对
    const keepRuns = Math.min(runCount, 1);

    // 当前 run 的观察只在超出更多时才收紧：它们是模型刚刚拿到的材料，
    // 折早了会逼它重新读一遍，反而更贵。
    const keepObservations = ratio < 2
        ? observationCount
        : ratio < 4
            ? Math.min(observationCount, 6)
            : Math.min(observationCount, 2);

    return {
        keepRuns,
        keepObservations,
        folded: keepRuns < runCount || keepObservations < observationCount,
        reason: `超出预算 ${ratio.toFixed(1)} 倍（≈${estimatedTokens} / ${budgetTokens} tokens）`,
    };
}

/** 头尾各留一段：中间省略。与工具输出预算的截断策略一致，不另立一套 */
export function foldObservationContent(tool: string, content: string): string {
    const head = Math.min(FOLD_HEAD_CHARS, content.length);
    const tailStart = Math.max(head, content.length - FOLD_TAIL_CHARS);
    const omitted = Math.max(0, tailStart - head);

    const body = omitted > 0
        ? `${content.slice(0, head)}…（省略 ${omitted} 字符）…${content.slice(tailStart)}`
        : content;

    return `${FOLD_MARKER} ${tool} 的这段输出已折叠为摘要，需要细节请重新调用工具。\n${body}`;
}

/**
 * 折叠一整个历史 run。
 *
 * 必须带上「怎么恢复」：模型看到一句「历史已折叠」却不知道能重读文件时，
 * 它会开始猜内容 —— 那比多花点 token 更糟。
 */
export function summarizePriorRun(run: PriorRun): string {
    return `任务目标: ${run.taskDescription}\n` +
        `（这段历史已折叠：${run.decisions.length} 轮决策 / ${run.observations.length} 次工具调用。` +
        `需要其中的内容时重新读取文件或重新执行，不要凭记忆复述。）`;
}

/** 折叠摘要是否已经折叠过（避免二次折叠产生嵌套标记） */
export function isFolded(content: string): boolean {
    return content.startsWith(FOLD_MARKER);
}

/**
 * 按字符数粗略推算 token。
 *
 * 「4 字符约 1 token」是通用经验值，够让阈值有数可读。**只用于估算**，
 * 实测值一律优先（见 AgentRunState.contextSize 的 source 字段）。
 */
export function estimateTokensFromChars(chars: number): number {
    return Math.ceil(chars / 4);
}

/**
 * 粗算历史 run 会占掉多少输入量。
 *
 * 只在「本次运行还没有实测值」时用（第一轮）：那时若直接放弃判断，一份很大的
 * 历史会在首轮把上下文顶满 —— 而这正是最该折叠的一刻。这里不建消息、不调工具，
 * 只把会送出去的那部分字符数加起来，误差靠折叠档位的宽度吸收。
 */
export function estimatePriorRunsTokens(runs: readonly PriorRun[]): number {
    let chars = 0;

    for (const run of runs) {
        chars += run.taskDescription.length;
        for (const step of run.plan.steps) {
            chars += step.description.length + step.completionCriteria.length;
        }

        for (const decision of run.decisions) {
            switch (decision.type) {
                case 'Action':
                    chars += decision.tool.length + JSON.stringify(decision.params ?? {}).length + (decision.thought?.length ?? 0);
                    break;
                case 'BatchAction':
                    for (const action of decision.actions) {
                        chars += action.tool.length + JSON.stringify(action.params ?? {}).length;
                    }
                    break;
                case 'Replan':
                    chars += decision.reason.length + decision.newPlan.length * 60;
                    break;
                case 'Final':
                    chars += decision.answer.length;
                    break;
            }
        }

        for (const observation of run.observations) {
            chars += observation.action.tool.length;
            chars += payloadLength(observation.result.data) + (observation.result.error?.length ?? 0);
        }
    }

    return estimateTokensFromChars(chars);
}

function payloadLength(data: unknown): number {
    if (data === null || data === undefined) return 0;
    if (typeof data === 'string') return data.length;
    try {
        return JSON.stringify(data)?.length ?? 0;
    } catch {
        // 循环引用等：估算而已，算作零
        return 0;
    }
}
