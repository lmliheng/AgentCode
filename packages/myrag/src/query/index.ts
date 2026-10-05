import type { ZVecCollection } from '@zvec/zvec'
import { embedTexts } from '../embed/index.js'
import { normalizeText } from '../parse/normalize.js'

/**
 * 检索层：dense 向量 / FTS 全文 / 两者融合（hybrid）。
 *
 * **默认用 dense**，依据是 47 条标注集的实测（`npm run eval -- eval/queries.json`）：
 *
 *   | 配置            | hit@10 | MRR   |
 *   | dense（默认）    | 95.7%  | 0.866 |
 *   | fts             | 83.0%  | 0.717 |
 *   | hybrid-rrf      | 93.6%  | 0.814 |
 *   | weighted 0.7/0.3| 93.6%  | 0.826 |
 *   | weighted 0.9/0.1| 93.6%  | 0.861 |
 *
 * 三种融合都不如 dense 单路 —— 融合会把 dense 的头部结果稀释掉。这个结论的适用范围是
 * 「本语料（TypeScript 中文文档）+ 智谱 embedding-3」；若语料里出现大量专有名词或
 * 代码标识符，FTS 的价值会上升，届时应当用评测重新比较，而不是沿用这个默认值。
 *
 * 三个关键设计：
 *   1. **hybrid 用 Zvec 原生 multiQuery**，融合在引擎内完成（rrf 或 weighted），
 *      不需要自己写 RRF 再排序。实测两种方式都可用（见 spike/zvec-spike.ts）。
 *   2. **按 group 折叠**。一个 section 被切成多个窗口时会额外产出「只有标题路径」的
 *      outline 块，它们共享同一个 group。不折叠的话 outline 会作为噪音命中；
 *      折叠后每个 group 只保留引擎排在最前的那一条。
 *   3. **内部多取**。折叠会让结果变少，所以实际检索 topk*3 条再折叠、最后截到 topk。
 */

export const VECTOR_FIELD = 'embedding'
export const FTS_FIELD = 'content'
export const DEFAULT_QUERY_TOPK = 5

/** 检索时取回的字段。content 必须包含，否则无法展示与引用 */
export const QUERY_OUTPUT_FIELDS = [
    'content',
    'source',
    'title',
    'scope',
    'heading',
    'kind',
    'category',
    'owner',
    'sourceVersion',
    'chunkIndex',
    'pageNumbers',
    'group',
]

export type QueryMode = 'hybrid' | 'dense' | 'fts'
export type RerankType = 'rrf' | 'weighted'

/** weighted 融合的默认权重，顺序对应 [dense, fts] */
export const DEFAULT_WEIGHTS: [number, number] = [0.7, 0.3]

export interface QueryOptions {
    question: string
    topk?: number | undefined
    /** 检索模式，默认 dense（见文件头部的实测依据） */
    mode?: QueryMode | undefined
    /** hybrid 模式下的融合方式，默认 rrf */
    rerank?: RerankType | undefined
    /** weighted 融合的权重，顺序 [dense, fts] */
    weights?: [number, number] | undefined
    /** Zvec filter 表达式，例如 "category = 'typescript-doc'"。字符串字面量用单引号 */
    filter?: string | undefined
    /** 向量维度，默认从 collection schema 读取 */
    dimensions?: number | undefined
    /** 是否按 group 折叠同一 section 的多窗结果，默认 true */
    collapseGroups?: boolean | undefined
}

export interface QueryHit {
    id: string
    /**
     * 相似度，**越大越相关**。dense 模式下已把 Zvec 返回的距离换算成余弦相似度
     * （实测 Zvec 的向量检索 score = 1 - 余弦），这样三种模式的 score 语义一致。
     */
    score: number
    content: string
    source: string
    title: string
    /** 标题路径，'::' 连接 */
    scope: string | null
    heading: string | null
    kind: string
    category: string
    owner: string
    sourceVersion: string
    chunkIndex: number
    pageNumbers: number[]
    /** 同一 section 的多窗/outline 共享此 id，用于折叠 */
    group: string | null
}

export interface QueryResult {
    question: string
    mode: QueryMode
    rerank: RerankType | null
    filter: string | null
    topk: number
    /** 折叠前的命中数 */
    rawCount: number
    hits: QueryHit[]
    tookMs: number
}

interface RawDoc {
    id: string
    score: number
    fields: Record<string, unknown>
}

/** 从 collection schema 读向量维度，避免调用方自己传错 */
export function dimensionOf(collection: ZVecCollection): number {
    const field = collection.schema.vectors().find((vector) => vector.name === VECTOR_FIELD)
    if (!field || typeof field.dimension !== 'number') {
        throw new Error(`collection 里找不到带维度的向量字段 ${VECTOR_FIELD}`)
    }
    return field.dimension
}

function toHit(doc: RawDoc): QueryHit {
    const fields = doc.fields ?? {}
    const scope = fields.scope
    const heading = fields.heading
    const group = fields.group
    const pageNumbers = fields.pageNumbers

    return {
        id: doc.id,
        score: doc.score,
        content: String(fields.content ?? ''),
        source: String(fields.source ?? ''),
        title: String(fields.title ?? ''),
        scope: typeof scope === 'string' ? scope : null,
        heading: typeof heading === 'string' ? heading : null,
        kind: String(fields.kind ?? ''),
        category: String(fields.category ?? ''),
        owner: String(fields.owner ?? ''),
        sourceVersion: String(fields.sourceVersion ?? ''),
        chunkIndex: Number(fields.chunkIndex ?? 0),
        pageNumbers: Array.isArray(pageNumbers) ? pageNumbers.map(Number) : [],
        group: typeof group === 'string' ? group : null,
    }
}

/**
 * 按 group 折叠：同一 group 只保留**首次出现**的一条。
 *
 * ⚠ 这里**不做重排序**，必须保持引擎返回的顺序。原因是 Zvec 两种查询的 score 语义相反：
 *   - 向量检索（querySync + vector）：score 是**距离**（实测等于 1 - 余弦），越小越近
 *   - FTS（querySync + fts）与 multiQuery：score 是**相似度**（BM25 / 融合分），越大越好
 * 但两种情况下引擎都已经按「最佳优先」返回，所以正确做法是保留顺序、去掉重复，
 * 任何按 score 的大小排序都会在其中一种模式上把结果倒过来。
 */
export function collapseGroups(hits: QueryHit[]): QueryHit[] {
    const seenGroups = new Set<string>()
    const collapsed: QueryHit[] = []

    for (const hit of hits) {
        if (hit.group === null) {
            collapsed.push(hit)
            continue
        }
        if (seenGroups.has(hit.group)) {
            continue
        }
        seenGroups.add(hit.group)
        collapsed.push(hit)
    }

    return collapsed
}

export async function retrieve(collection: ZVecCollection, options: QueryOptions): Promise<QueryResult> {
    const startedAt = Date.now()
    // 提问也归一化：用户输入正常汉字时是 no-op；万一混进兼容字符也能对上库里的正文
    const question = normalizeText(options.question).trim()
    if (question.length === 0) {
        throw new Error('提问不能为空')
    }

    const mode: QueryMode = options.mode ?? 'dense'
    const rerank: RerankType | null = mode === 'hybrid' ? options.rerank ?? 'rrf' : null
    const topk = options.topk ?? DEFAULT_QUERY_TOPK
    const collapse = options.collapseGroups ?? true
    // 折叠会减少条数，所以先多取一些
    const fetchCount = collapse ? topk * 3 : topk
    // Zvec 的 filter 类型是 `filter?: string`，不接受 null；未指定时必须整块省略
    const filterPatch = options.filter === undefined ? {} : { filter: options.filter }

    let raw: RawDoc[]

    if (mode === 'fts') {
        raw = collection.querySync({
            fieldName: FTS_FIELD,
            fts: { matchString: question },
            topk: fetchCount,
            outputFields: QUERY_OUTPUT_FIELDS,
            ...filterPatch,
        })
    } else {
        const dimensions = options.dimensions ?? dimensionOf(collection)
        const embedded = await embedTexts([question], { dimensions, batchSize: 1, delayMs: 0 })
        const vector = embedded.vectors[0]
        if (!vector || vector.length === 0) {
            throw new Error('提问向量化失败，返回空向量')
        }

        if (mode === 'dense') {
            raw = collection.querySync({
                fieldName: VECTOR_FIELD,
                vector,
                topk: fetchCount,
                outputFields: QUERY_OUTPUT_FIELDS,
                ...filterPatch,
            })
        } else {
            const weights = options.weights ?? DEFAULT_WEIGHTS
            raw = collection.multiQuerySync({
                queries: [
                    { fieldName: VECTOR_FIELD, vector },
                    { fieldName: FTS_FIELD, fts: { matchString: question } },
                ],
                topk: fetchCount,
                outputFields: QUERY_OUTPUT_FIELDS,
                ...filterPatch,
                rerank:
                    rerank === 'weighted'
                        ? { type: 'weighted', weights }
                        : { type: 'rrf' },
            })
        }
    }

    // 统一 score 语义：dense 模式下 Zvec 返回的是距离（1 - 余弦），换算成余弦相似度，
    // 让三种模式的 score 都是「越大越相关」，避免调用方与展示层误判方向。
    // 注意：换算不影响顺序（单调变换），顺序始终以引擎返回的为准。
    const all = raw.map((doc) => toHit(mode === 'dense' ? { ...doc, score: 1 - doc.score } : doc))
    const collapsed = collapse ? collapseGroups(all) : all

    return {
        question,
        mode,
        rerank,
        filter: options.filter ?? null,
        topk,
        rawCount: all.length,
        hits: collapsed.slice(0, topk),
        tookMs: Date.now() - startedAt,
    }
}
