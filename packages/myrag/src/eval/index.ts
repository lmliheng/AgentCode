import type { ZVecCollection } from '@zvec/zvec'
import { retrieve, type QueryHit, type QueryOptions } from '../query/index.js'

/**
 * 检索评测。
 *
 * 存在的理由：实测发现不同检索模式的优劣**无法靠眼看 2~3 个 query 判断**。
 * 例如「怎么判断一个变量的具体类型」这句，dense 单独跑 Top-1 是对的，
 * 但 multiQuery 融合（无论 rrf、weighted 0.8 还是 weighted 0.9）都会把它挤出前 3。
 * 所以必须有标注集 + 指标，才能判断某个配置是不是真的更好。
 *
 * 指标定义：
 *   hit@k  —— 前 k 条里出现期望来源的 query 占比
 *   MRR    —— 首个命中期望来源的排名的倒数均值；未命中记 0
 */

export interface LabeledQuery {
    id?: string
    question: string
    /** 期望命中的来源（metadata.source，即相对入库根的路径），命中其一即算命中 */
    expectSources: string[]
    /** 可选：同时要求 scope（标题路径）完全相等 */
    expectScope?: string
    /** 备注：说明这条 query 想考察什么 */
    note?: string
}

export interface LabeledSet {
    description?: string
    queries: LabeledQuery[]
}

export interface QueryOutcome {
    query: LabeledQuery
    /** 首个命中的排名（1 起）；未命中为 null */
    rank: number | null
    top1Source: string | null
    top1Scope: string | null
    hitCount: number
    tookMs: number
}

export interface ModeReport {
    label: string
    options: QueryOptions
    hitAtK: number
    mrr: number
    outcomes: QueryOutcome[]
}

/** 一个评测配置：标签 + retrieve 的参数 */
export interface ModePreset {
    label: string
    options: Pick<QueryOptions, 'mode' | 'rerank' | 'weights'>
}

/**
 * 默认对比的配置集合。
 * 覆盖三档：单路（dense / fts）、rank 融合（rrf）、加权融合（不同 dense 权重）。
 */
export const DEFAULT_MODE_PRESETS: ModePreset[] = [
    { label: 'dense', options: { mode: 'dense' } },
    { label: 'fts', options: { mode: 'fts' } },
    { label: 'hybrid-rrf', options: { mode: 'hybrid', rerank: 'rrf' } },
    { label: 'weighted-0.7/0.3', options: { mode: 'hybrid', rerank: 'weighted', weights: [0.7, 0.3] } },
    { label: 'weighted-0.9/0.1', options: { mode: 'hybrid', rerank: 'weighted', weights: [0.9, 0.1] } },
]

function matches(hit: QueryHit, query: LabeledQuery): boolean {
    if (!query.expectSources.includes(hit.source)) {
        return false
    }
    if (query.expectScope !== undefined) {
        return hit.scope === query.expectScope
    }
    return true
}

export interface EvaluateOptions {
    topk?: number
    filter?: string | undefined
    collapseGroups?: boolean | undefined
    /** 只跑指定的配置标签；不传则跑全部默认配置 */
    modes?: string[] | undefined
}

export async function evaluate(
    collection: ZVecCollection,
    set: LabeledSet,
    options: EvaluateOptions = {}
): Promise<ModeReport[]> {
    const topk = options.topk ?? 10
    const presets = options.modes
        ? DEFAULT_MODE_PRESETS.filter((preset) => options.modes?.includes(preset.label))
        : DEFAULT_MODE_PRESETS

    if (presets.length === 0) {
        throw new Error(
            `没有匹配的评测配置。可用：${DEFAULT_MODE_PRESETS.map((preset) => preset.label).join(' / ')}`
        )
    }

    const reports: ModeReport[] = []

    for (const preset of presets) {
        const outcomes: QueryOutcome[] = []

        for (const query of set.queries) {
            const result = await retrieve(collection, {
                question: query.question,
                topk,
                filter: options.filter,
                collapseGroups: options.collapseGroups,
                ...preset.options,
            })

            let rank: number | null = null
            let hitCount = 0
            result.hits.forEach((hit, index) => {
                if (matches(hit, query)) {
                    hitCount++
                    if (rank === null) {
                        rank = index + 1
                    }
                }
            })

            const first = result.hits[0]
            outcomes.push({
                query,
                rank,
                top1Source: first?.source ?? null,
                top1Scope: first?.scope ?? null,
                hitCount,
                tookMs: result.tookMs,
            })
        }

        const hitAtK = outcomes.filter((outcome) => outcome.rank !== null).length / Math.max(1, outcomes.length)
        const mrr =
            outcomes.reduce((sum, outcome) => sum + (outcome.rank === null ? 0 : 1 / outcome.rank), 0) /
            Math.max(1, outcomes.length)

        reports.push({ label: preset.label, options: { question: '', ...preset.options }, hitAtK, mrr, outcomes })
    }

    return reports
}

export function renderEvalReport(reports: ModeReport[], topk: number): string {
    const lines: string[] = []

    lines.push('| 配置 | hit@k | MRR | 未命中数 |')
    lines.push('|---|---|---|---|')
    for (const report of reports) {
        const missed = report.outcomes.filter((outcome) => outcome.rank === null).length
        lines.push(
            `| ${report.label} | ${(report.hitAtK * 100).toFixed(1)}% | ${report.mrr.toFixed(3)} | ${missed} / ${report.outcomes.length} |`
        )
    }
    lines.push('')

    // 逐条 query：列出各配置的排名，方便看出「哪个配置在哪条上失效」
    lines.push('| query | ' + reports.map((report) => report.label).join(' | ') + ' |')
    lines.push('|---|' + reports.map(() => '---').join('|') + '|')
    const queryCount = reports[0]?.outcomes.length ?? 0
    for (let index = 0; index < queryCount; index++) {
        const first = reports[0]?.outcomes[index]
        const question = first?.query.question ?? ''
        const short = question.length > 26 ? `${question.slice(0, 26)}…` : question
        const cells = reports.map((report) => {
            const outcome = report.outcomes[index]
            if (!outcome) return '?'
            return outcome.rank === null ? '✗' : `#${outcome.rank}`
        })
        lines.push(`| ${short} | ${cells.join(' | ')} |`)
    }
    lines.push('')

    // 失败的细节：把没命中的 query 的 Top-1 打出来，便于判断是分块问题还是检索问题
    const failures: string[] = []
    for (const report of reports) {
        for (const outcome of report.outcomes) {
            if (outcome.rank !== null) continue
            failures.push(
                `  [${report.label}] ${outcome.query.id ?? ''} 「${outcome.query.question}」\n` +
                    `      期望 ${outcome.query.expectSources.join(' / ')}${outcome.query.expectScope ? ` (scope=${outcome.query.expectScope})` : ''}\n` +
                    `      实际 Top-1 ${outcome.top1Source ?? '(无)'}${outcome.top1Scope ? ` (scope=${outcome.top1Scope})` : ''}`
            )
        }
    }

    if (failures.length > 0) {
        lines.push(`未命中明细（topk=${topk}）：`)
        lines.push('')
        lines.push(failures.join('\n'))
    }

    return lines.join('\n')
}
