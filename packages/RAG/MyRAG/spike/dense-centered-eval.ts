/**
 * 模拟验证「中心化」能否修好 dense。
 *
 * 背景：spike/dense-diagnose.ts 发现 dense 压缩的主因是 embedding 各向异性（cone effect）——
 * 无关块之间余弦就有 0.385~0.45，query-chunk 也只有 ~0.40，信号只比基线高 0.015。
 * 在已取回的向量上减掉均值向量再归一化，score 极差能提高 2~3 倍。
 *
 * 但「中心化」要落到 Zvec 上需要：metric 从 COSINE 换成 IP（COSINE 会重新归一化、
 * 破坏中心化）、离线对所有向量做变换、并且维护一个均值向量文件（丢了或不一致会静默降质）。
 * 所以在动 schema 之前，先在内存里模拟整个评测，看 hit@k / MRR 到底能提升多少。
 *
 * 运行：tsx --env-file=../rag-chunk/.env spike/dense-centered-eval.ts
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFile } from '../src/parse/index.js'
import { documentToChunks } from '../src/chunk/index.js'
import { embedTexts } from '../src/embed/index.js'

const DATA_DIR = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/Milvus/data'
const DOC_DIR = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/rag-chunk/documents'
const SEED_SET = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/MyRAG/eval/queries.json'
const DIMENSIONS = 1024
const TOPK = 10

interface LabeledQuery {
    id?: string
    question: string
    expectSources: string[]
}

function walk(dir: string, extensions: RegExp): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'jsx') continue
        const path = join(dir, entry.name)
        if (entry.isDirectory()) out.push(...walk(path, extensions))
        else if (extensions.test(entry.name)) out.push(path)
    }
    return out
}

function cosine(first: number[], second: number[]): number {
    let dot = 0
    let normFirst = 0
    let normSecond = 0
    for (let index = 0; index < first.length; index++) {
        const a = first[index] ?? 0
        const b = second[index] ?? 0
        dot += a * b
        normFirst += a * a
        normSecond += b * b
    }
    return dot / (Math.sqrt(normFirst) * Math.sqrt(normSecond))
}

/** 两点内积。中心化 + 归一化之后用它，等价于「去基线后的余弦」 */
function innerProduct(first: number[], second: number[]): number {
    let dot = 0
    for (let index = 0; index < first.length; index++) {
        dot += (first[index] ?? 0) * (second[index] ?? 0)
    }
    return dot
}

function l2normalize(vector: number[]): number[] {
    let norm = 0
    for (const value of vector) norm += value * value
    const length = Math.sqrt(norm)
    return length === 0 ? vector : vector.map((value) => value / length)
}

function meanVector(vectors: number[][]): number[] {
    const mean = new Array<number>(DIMENSIONS).fill(0)
    for (const vector of vectors) {
        for (let index = 0; index < DIMENSIONS; index++) {
            mean[index] = (mean[index] ?? 0) + (vector[index] ?? 0) / vectors.length
        }
    }
    return mean
}

function subtract(vector: number[], base: number[]): number[] {
    return vector.map((value, index) => value - (base[index] ?? 0))
}

// ---------------------------------------------------------------- 语料

console.log('解析语料…')
const files = [
    ...walk(DATA_DIR, /\.md$/i),
    ...walk(DOC_DIR, /\.(md|docx|pdf)$/i),
]

interface Item {
    source: string
    embedText: string
}

const items: Item[] = []
for (const path of files) {
    const doc = await parseFile(path)
    for (const chunk of documentToChunks(doc, { category: 'sim', owner: 'sim', sourceVersion: 'v1' })) {
        items.push({ source: chunk.metadata.source, embedText: chunk.embedText })
    }
}
console.log(`${files.length} 个文件　${items.length} 个 chunk`)
console.log('')

const set = JSON.parse(readFileSync(SEED_SET, 'utf8')) as { queries: LabeledQuery[] }
console.log(`评测集：${set.queries.length} 条 query`)
console.log('')

// ---------------------------------------------------------------- 向量化

console.log('向量化（全语料 + 问句）…')
const itemVectors = (await embedTexts(items.map((item) => item.embedText), { dimensions: DIMENSIONS })).vectors
const questionVectors = (
    await embedTexts(set.queries.map((query) => query.question), { dimensions: DIMENSIONS })
).vectors
console.log('完成')
console.log('')

// ---------------------------------------------------------------- 中心化

const mean = meanVector(itemVectors)
const centeredItems = itemVectors.map((vector) => l2normalize(subtract(vector, mean)))

function rankOf(scores: number[], query: LabeledQuery): number | null {
    const order = scores
        .map((score, index) => ({ score, index }))
        .sort((first, second) => second.score - first.score)
        .slice(0, TOPK)

    for (let position = 0; position < order.length; position++) {
        const entry = order[position]
        const item = entry ? items[entry.index] : undefined
        if (item && query.expectSources.includes(item.source)) {
            return position + 1
        }
    }
    return null
}

interface Metrics {
    hitAtK: number
    mrr: number
    ranks: Array<number | null>
}

function metricsOf(scoring: (questionIndex: number) => number[]): Metrics {
    const ranks: Array<number | null> = []
    set.queries.forEach((query, index) => {
        ranks.push(rankOf(scoring(index), query))
    })
    const hitAtK = ranks.filter((rank) => rank !== null).length / Math.max(1, ranks.length)
    const mrr =
        ranks.reduce<number>((sum, rank) => sum + (rank === null ? 0 : 1 / rank), 0) /
        Math.max(1, ranks.length)
    return { hitAtK, mrr, ranks }
}

const rawMetrics = metricsOf((index) => {
    const question = questionVectors[index]
    if (!question) return []
    return itemVectors.map((item) => cosine(question, item))
})

const centeredMetrics = metricsOf((index) => {
    const question = questionVectors[index]
    if (!question) return []
    const centeredQuestion = l2normalize(subtract(question, mean))
    return centeredItems.map((item) => innerProduct(centeredQuestion, item))
})

console.log('=== dense 单路：原始 vs 中心化（topk=10）===')
console.log('| 表示 | hit@10 | MRR | 未命中 |')
console.log('|---|---|---|---|')
console.log(
    `| 原始余弦 | ${(rawMetrics.hitAtK * 100).toFixed(1)}% | ${rawMetrics.mrr.toFixed(3)} | ${rawMetrics.ranks.filter((r) => r === null).length} / ${set.queries.length} |`
)
console.log(
    `| 中心化 + IP | ${(centeredMetrics.hitAtK * 100).toFixed(1)}% | ${centeredMetrics.mrr.toFixed(3)} | ${centeredMetrics.ranks.filter((r) => r === null).length} / ${set.queries.length} |`
)
console.log('')

console.log('| query | 原始排名 | 中心化排名 |')
console.log('|---|---|---|')
set.queries.forEach((query, index) => {
    const raw = rawMetrics.ranks[index]
    const centered = centeredMetrics.ranks[index]
    const short = query.question.length > 26 ? `${query.question.slice(0, 26)}…` : query.question
    console.log(`| ${short} | ${raw === null ? '✗' : `#${raw}`} | ${centered === null ? '✗' : `#${centered}`} |`)
})
console.log('')

// 均值向量的性质：如果它把大部分向量「拉走」，说明各向异性确实明显
let normSum = 0
for (const value of mean) normSum += value * value
const centeredNorm = centeredItems.map((vector) => {
    let sum = 0
    for (const value of vector) sum += value * value
    return sum
})
console.log(`均值向量的 L2 范数：${Math.sqrt(normSum).toFixed(4)}（单位向量范数为 1，越大越说明所有向量共享一个强共同方向）`)
console.log(
    `中心化后各向量范数：min=${Math.min(...centeredNorm).toFixed(3)} max=${Math.max(...centeredNorm).toFixed(3)}（归一化后应恒为 1）`
)
