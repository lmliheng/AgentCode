/**
 * 自检索测试：区分「向量表示坏了」还是「query 与 chunk 之间有语义鸿沟」。
 *
 * 做法：拿语料自己的 chunk 当查询，看它能不能把**自己**检索回来。
 *   - 如果自检索命中率很高 → 向量表示是好的，种子集上失败的原因是「用户问句」与「正文」
 *     之间的语义鸿沟（问句短、抽象，正文长、具体），该往查询改写 / 摘要方向修。
 *   - 如果自检索也差 → 向量表示本身有问题（模型不适配这个语料 / 内容被代码稀释），
 *     换模型或改变被向量化的内容才有意义。
 *
 * 两种查询形态各测一遍：
 *   content-as-query  用 chunk 正文当查询（上界，理论上应该几乎全中）
 *   heading-as-query  用 chunk 的标题当查询（更接近真实问句的长度与抽象度）
 *
 * 同时打印种子集每条 query 期望来源的**完整排名**，看清楚是差一点还是差很远。
 *
 * 运行：tsx --env-file=../rag-chunk/.env spike/dense-selfretrieval.ts
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
/** 自检索抽样的 chunk 数 */
const SAMPLE = 50

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

// ---------------------------------------------------------------- 语料

console.log('解析语料…')
const files = [
    ...walk(DATA_DIR, /\.md$/i),
    ...walk(DOC_DIR, /\.(md|docx|pdf)$/i),
]

interface Item {
    source: string
    /** 只对 text 类型做自检索：outline 块内容就是标题，没有可比性 */
    kind: string
    content: string
    heading: string | null
    embedText: string
}

const items: Item[] = []
for (const path of files) {
    const doc = await parseFile(path)
    for (const chunk of documentToChunks(doc, { category: 'self', owner: 'self', sourceVersion: 'v1' })) {
        items.push({
            source: chunk.metadata.source,
            kind: chunk.metadata.kind,
            content: chunk.content,
            heading: chunk.metadata.heading,
            embedText: chunk.embedText,
        })
    }
}
console.log(`${files.length} 个文件　${items.length} 个 chunk`)
console.log('')

// ---------------------------------------------------------------- 向量化

console.log('向量化（全语料）…')
const itemVectors = (await embedTexts(items.map((item) => item.embedText), { dimensions: DIMENSIONS })).vectors

// 抽样：只取 text 类型、且有标题、长度适中的 chunk，避免 outline / 超长块干扰
const candidates = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === 'text' && item.heading !== null && item.content.length >= 150)
const step = Math.max(1, Math.floor(candidates.length / SAMPLE))
const sampled = candidates.filter((_, position) => position % step === 0).slice(0, SAMPLE)
console.log(`自检索抽样：${sampled.length} 个 chunk（text 类、有标题、≥150 字符）`)
console.log('')

const contentQueries = sampled.map(({ item }) => item.content)
const headingQueries = sampled.map(({ item }) => item.heading ?? '')

console.log('向量化（自检索查询：正文 / 标题）…')
const contentQueryVectors = (await embedTexts(contentQueries, { dimensions: DIMENSIONS })).vectors
const headingQueryVectors = (await embedTexts(headingQueries, { dimensions: DIMENSIONS })).vectors

const seedSet = JSON.parse(readFileSync(SEED_SET, 'utf8')) as { queries: LabeledQuery[] }
const seedVectors = (
    await embedTexts(seedSet.queries.map((query) => query.question), { dimensions: DIMENSIONS })
).vectors
console.log('完成')
console.log('')

// ---------------------------------------------------------------- 排名工具

/** 返回 selfIndex 在全部候选中按分数降序的名次（1 起）；同时返回分数 */
function rankSelf(queryVector: number[], selfIndex: number): { rank: number; score: number } {
    let rank = 1
    let score = -Infinity
    for (let index = 0; index < itemVectors.length; index++) {
        const vector = itemVectors[index]
        if (!vector) continue
        const similarity = cosine(queryVector, vector)
        if (index === selfIndex) {
            score = similarity
            continue
        }
        if (similarity > score) {
            rank++
        }
    }
    return { rank, score }
}

function summarize(label: string, entries: Array<{ rank: number }>) {
    const at = (k: number) => entries.filter((entry) => entry.rank <= k).length
    const total = entries.length
    const ranks = entries.map((entry) => entry.rank).sort((a, b) => a - b)
    console.log(
        `  ${label.padEnd(20)} hit@1=${at(1)}/${total}  hit@5=${at(5)}/${total}  hit@10=${at(10)}/${total}  ` +
            `中位排名=${ranks[Math.floor(total / 2)] ?? 0}  最差=${ranks[total - 1] ?? 0}`
    )
}

console.log('=== 自检索（chunk 能否检索回自己）===')
const contentRanks = sampled.map(({ index }, position) => {
    const vector = contentQueryVectors[position]
    return vector ? rankSelf(vector, index) : { rank: items.length, score: 0 }
})
const headingRanks = sampled.map(({ index }, position) => {
    const vector = headingQueryVectors[position]
    return vector ? rankSelf(vector, index) : { rank: items.length, score: 0 }
})
summarize('正文当查询', contentRanks)
summarize('标题当查询', headingRanks)
console.log('')

console.log('=== 种子集：期望来源在 dense 下的完整排名 ===')
console.log('（不是「在不在 top10」，而是确切的第几名，用来看是差一点还是差很远）')
console.log('')
console.log('| query | 期望来源 | dense 名次 | 命中最高分 |')
console.log('|---|---|---|---|')

seedSet.queries.forEach((query, position) => {
    const vector = seedVectors[position]
    if (!vector) return

    const matches = items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => query.expectSources.includes(item.source))
    if (matches.length === 0) {
        console.log(`| ${query.question} | ${query.expectSources.join('/')} | (库中不存在) | - |`)
        return
    }

    // 期望来源里分数最高的那个 chunk 的排名
    let best: { rank: number; score: number } | null = null
    for (const match of matches) {
        const result = rankSelf(vector, match.index)
        if (!best || result.score > best.score) {
            best = result
        }
    }

    const short = query.question.length > 24 ? `${query.question.slice(0, 24)}…` : query.question
    console.log(`| ${short} | ${query.expectSources.join(' / ')} | #${best?.rank ?? '?'} | ${best?.score.toFixed(4) ?? '-'} |`)
})
