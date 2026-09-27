// 上下文折叠：判据与摘要渲染。
//
// 折叠本身是视图层动作，但「折多少」与「摘要长什么样」必须钉住 ——
// 折多了模型会开始猜内容，折少了等于没折。

import { describe, it, expect } from 'vitest';
import {
    FOLD_MARKER,
    foldObservationContent,
    isFolded,
    planContextFold,
    summarizePriorRun,
} from '../src/context-fold.js';
import type { PriorRun } from '../src/types/Runtime.js';

describe('折叠判据', () => {
    it('在预算内不折', () => {
        const plan = planContextFold({
            estimatedTokens: 1000,
            budgetTokens: 2000,
            runCount: 3,
            observationCount: 20,
        });

        expect(plan.folded).toBe(false);
        expect(plan.keepRuns).toBe(3);
        expect(plan.keepObservations).toBe(20);
    });

    it('刚超预算是先折历史 run，不动当前 run 的观察', () => {
        const plan = planContextFold({
            estimatedTokens: 2500,
            budgetTokens: 2000,
            runCount: 3,
            observationCount: 20,
        });

        expect(plan.folded).toBe(true);
        expect(plan.keepRuns).toBe(1);
        expect(plan.keepObservations).toBe(20);
        expect(plan.reason).toContain('1.3');
    });

    it('超出更多时收紧当前 run 的观察，但保留最近几条', () => {
        const six = planContextFold({
            estimatedTokens: 6000, // 3 倍
            budgetTokens: 2000,
            runCount: 0,
            observationCount: 20,
        });
        expect(six.keepObservations).toBe(6);

        const two = planContextFold({
            estimatedTokens: 20000, // 10 倍
            budgetTokens: 2000,
            runCount: 0,
            observationCount: 20,
        });
        expect(two.keepObservations).toBe(2);
    });

    it('观察本来就比保留数少时不会「折出负数」', () => {
        const plan = planContextFold({
            estimatedTokens: 20000,
            budgetTokens: 2000,
            runCount: 0,
            observationCount: 1,
        });

        expect(plan.keepObservations).toBe(1);
        // 一条都没折到就不算折叠
        expect(plan.folded).toBe(false);
    });

    it('没有可用度量（0）时不折：宁可不折，也不要凭空折掉历史', () => {
        const plan = planContextFold({
            estimatedTokens: 0,
            budgetTokens: 2000,
            runCount: 5,
            observationCount: 5,
        });

        expect(plan.folded).toBe(false);
    });

    it('预算被显式关闭（<=0）时不折', () => {
        const plan = planContextFold({
            estimatedTokens: 10_000_000,
            budgetTokens: 0,
            runCount: 5,
            observationCount: 5,
        });

        expect(plan.folded).toBe(false);
        expect(plan.reason).toContain('未设上下文预算');
    });
});

describe('观察摘要', () => {
    it('保留头尾、中间省略，并说明可以重新调用工具', () => {
        const content = `开头${'x'.repeat(5000)}结尾`;

        const folded = foldObservationContent('read_file', content);

        expect(folded.startsWith(FOLD_MARKER)).toBe(true);
        expect(folded).toContain('read_file');
        expect(folded).toContain('开头');
        expect(folded).toContain('结尾');
        expect(folded).toContain('省略');
        expect(folded).toContain('重新调用工具');
        // 摘要必须显著短于原文
        expect(folded.length).toBeLessThan(500);
    });

    it('短内容原样保留（不产生无意义的省略标记）', () => {
        const folded = foldObservationContent('read_file', '很短的内容');

        expect(folded).toContain('很短的内容');
        expect(folded).not.toContain('省略');
    });

    it('isFolded 认得出已经折过的内容', () => {
        expect(isFolded(foldObservationContent('x', '正文'))).toBe(true);
        expect(isFolded('正文')).toBe(false);
    });
});

describe('历史 run 摘要', () => {
    it('说清做了什么、折了多少、怎么恢复', () => {
        const run: PriorRun = {
            taskDescription: '把 README 改成中文',
            plan: { originalGoal: '把 README 改成中文', steps: [], currentStepIndex: 0, version: 1 },
            decisions: [{ type: 'Final', answer: '完成' }],
            observations: [{ action: { type: 'Action', tool: 'read_file', params: {} }, result: { success: true, data: 'x' }, timestamp: 0 }],
        };

        const summary = summarizePriorRun(run);

        expect(summary).toContain('把 README 改成中文');
        expect(summary).toContain('1 轮决策');
        expect(summary).toContain('1 次工具调用');
        // 必须告诉模型怎么把细节找回来，否则它会开始猜
        expect(summary).toContain('重新读取');
    });
});
