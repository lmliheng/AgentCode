/**
 * dense 根因诊断（修正版）。
 *
 * 上一版有两个错误，这里都修掉了：
 *   1. 用 `content` 当查询却与 `embedText`（带元信息前缀）的向量比较 —— 那是两段不同文本，
 *      根本不算「自检索」。
 *   2. 调 documentToChunks 时没传 source，metadata.source 回退成 basename，
 *      导致期望来源（相对路径）全部匹配不上。
 *
 * 本版回答三个问题：
 *   A. **向量是否确定性** —— 同一文本分别单独调用 3 次，余弦应恒为 1.0。
 *      如果不等，说明排序不稳定是 API 噪声，任何调参都白费。
 *   B. **真正的自检索** —— 用同一字符串做索引与查询，看能否拿回自己。分别测
 *      embedText 与 content 两种表示。
 *   C. **元信息前缀的影响** —— cos(embed(content), embed(embedText)) 的分布。
 *      如果普遍很低，说明前缀大幅改变了向量（那时它就是主因，而不是次要因素）。
 *
 * 运行：tsx --env-file=../rag-chunk/.env spike/dense-diagnose2.ts
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parseFile } from '../src/parse/index.js'
import { documentToChunks } from '../src/chunk/index.js'
import { embedTexts } from '../src/embed/index.js'

const ROOTS = [
    { dir: 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/Milvus/data', extensions: /\.md$/i, skipJsx: true },
    { dir: 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/rag-chunk/documents', extensions: /\.(md|docx|pdf)$/i, skipJsx: false },
]
const SEED_SET = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/MyRAG/eval/queries.json'
const DIMENSIONS = 1024
const SAMPLE = 30

interface LabeledQuery {
    question: string
    expectSources: string[]
}

function walk(dir: string, extensions: RegExp, skipJsx: boolean): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (skipJsx && entry.name === 'jsx') continue
        const path = join(dir, entry.name)
        if (entry.isDirectory()) out.push(...walk(path, extensions, skipJsx))
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

// ---------------------------------------------------------------- 语料（source 用相对路径，与 ingest 一致）

console.log('解析语料…')
interface Item {
    source: string
    kind: string
    content: string
    embedText: string
}

const items: Item[] = []
for (const root of ROOTS) {
    for (const path of walk(root.dir, root.extensions, root.skipJsx)) {
        const doc = await parseFile(path)
        // 与 CLI 的 sourceKey 一致：相对入库根目录的路径，统一用 / 分隔
        const source = relative(resolve(root.dir), resolve(path)).split(/[\\/]/).join('/')
        for (const chunk of documentToChunks(doc, {
            category: 'diag',
            owner: 'diag',
            sourceVersion: 'v1',
            source,
        })) {
            items.push({
                source: chunk.metadata.source,
                kind: chunk.metadata.kind,
                content: chunk.content,
                embedText: chunk.embedText,
            })
        }
    }
}
console.log(`${items.length} 个 chunk，来源去重后 ${new Set(items.map((item) => item.source)).size} 个`)
console.log('')

// ---------------------------------------------------------------- A. 确定性

console.log('=== A) 向量确定性：同一文本分别单独调用 3 次 ===')
const probeText = '怎么判断一个变量的具体类型'
const repeats = (await embedTexts([probeText, probeText, probeText], { dimensions: DIMENSIONS })).vectors
const first = repeats[0]
const second = repeats[1]
const third = repeats[2]
if (first && second && third) {
    console.log(`  第1次 vs 第2次 余弦 = ${cosine(first, second).toFixed(8)}`)
    console.log(`  第1次 vs 第3次 余弦 = ${cosine(first, third).toFixed(8)}`)
    console.log(`  第2次 vs 第3次 余弦 = ${cosine(second, third).toFixed(8)}`)
    console.log('  若恒为 1.00000000 则确定；否则排序不稳定来自 API 噪声')
}
// 同一次请求内重复（批量里放两份相同文本）
const batched = (await embedTexts([probeText, '无关的填充文本', probeText], { dimensions: DIMENSIONS })).vectors
const batchedFirst = batched[0]
const batchedThird = batched[2]
if (batchedFirst && batchedThird) {
    console.log(`  同批次内两份相同文本 余弦 = ${cosine(batchedFirst, batchedThird).toFixed(8)}`)
}
console.log('')

// ---------------------------------------------------------------- 全语料向量 + 抽样

console.log('向量化（全语料 embedText）…')
const embedTextVectors = (await embedTexts(items.map((item) => item.embedText), { dimensions: DIMENSIONS })).vectors

const candidates = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === 'text' && item.content.length >= 150)
const step = Math.max(1, Math.floor(candidates.length / SAMPLE))
const sampled = candidates.filter((_, position) => position % step === 0).slice(0, SAMPLE)
console.log(`抽样 ${sampled.length} 个 chunk 做自检索`)
console.log('')

console.log('向量化（抽样 chunk 的 content / embedText 重复向量化）…')
const sampledEmbedTexts = sampled.map(({ item }) => item.embedText)
const sampledContents = sampled.map(({ item }) => item.content)
/** 再次向量化同一批 embedText：与全语料那一批的对应向量比，检验批次影响 */
const sampledEmbedTextVectorsAgain = (await embedTexts(sampledEmbedTexts, { dimensions: DIMENSIONS })).vectors
const sampledContentVectors = (await embedTexts(sampledContents, { dimensions: DIMENSIONS })).vectors
console.log('完成')
console.log('')

function rankSelf(queryVector: number[], selfIndex: number, pool: number[][]): number {
    const selfScore = cosine(queryVector, pool[selfIndex] ?? [])
    let better = 0
    for (let index = 0; index < pool.length; index++) {
        if (index === selfIndex) continue
        if (cosine(queryVector, pool[index] ?? []) > selfScore) better++
    }
    return better + 1
}

function summarize(label: string, ranks: number[]) {
    const at = (k: number) => ranks.filter((rank) => rank <= k).length
    const sorted = [...ranks].sort((a, b) => a - b)
    console.log(
        `  ${label.padEnd(30)} hit@1=${at(1)}/${ranks.length}  hit@5=${at(5)}/${ranks.length}  hit@10=${at(10)}/${ranks.length}  中位=${sorted[Math.floor(ranks.length / 2)] ?? 0}  最差=${sorted[ranks.length - 1] ?? 0}`
    )
}

console.log('=== B) 真正的自检索（同字符串索引 + 同字符串查询）===')
const selfRanks = sampled.map(({ index }, position) => {
    const vector = sampledEmbedTextVectorsAgain[position]
    return vector ? rankSelf(vector, index, embedTextVectors) : embedTextVectors.length
})
summarize('embedText vs embedText', selfRanks)

// content 自检索：把 content 的向量当作池子（等长数组，非 text chunk 位置留空）
const contentPool: number[][] = items.map(() => [])
sampled.forEach(({ index }, position) => {
    const vector = sampledContentVectors[position]
    if (vector) contentPool[index] = vector
})
const contentSelfRanks = sampled.map(({ index }, position) => {
    const vector = sampledContentVectors[position]
    return vector ? rankSelf(vector, index, contentPool) : sampled.length
})
summarize('content vs content', contentSelfRanks)
console.log('')

console.log('=== C) 元信息前缀对向量的影响 ===')
const prefixCosines = sampled.map(({ index }, position) => {
    const contentVector = sampledContentVectors[position]
    const indexed = embedTextVectors[index]
    return contentVector && indexed ? cosine(contentVector, indexed) : 0
})
const sortedCosines = [...prefixCosines].sort((a, b) => a - b)
console.log(
    `  cos(embed(content), embed(embedText)) 同一个 chunk：min=${(sortedCosines[0] ?? 0).toFixed(4)} 中位=${(sortedCosines[Math.floor(sortedCosines.length / 2)] ?? 0).toFixed(4)} max=${(sortedCosines[sortedCosines.length - 1] ?? 0).toFixed(4)}`
)
console.log('  越接近 1 说明前缀影响越小；明显低于 1 说明前缀显著改变了向量方向')
console.log('')

// ---------------------------------------------------------------- D. 种子集真实排名

const seedSet = JSON.parse(readFileSync(SEED_SET, 'utf8')) as { queries: LabeledQuery[] }
const seedVectors = (await embedTexts(seedSet.queries.map((query) => query.question), { dimensions: DIMENSIONS })).vectors

console.log('=== D) 种子集：期望来源在 dense 下的真实排名（source 已修正为相对路径）===')
console.log('')
console.log('| query | 期望来源 | dense 名次 | 分数 |')
console.log('|---|---|---|---|')

seedSet.queries.forEach((query, position) => {
    const vector = seedVectors[position]
    if (!vector) return

    const matches = items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => query.expectSources.includes(item.source))

    if (matches.length === 0) {
        console.log(`| ${query.question} | ${query.expectSources.join(' / ')} | (库中不存在) | - |`)
        return
    }

    let bestRank = embedTextVectors.length
    let bestScore = -Infinity
    for (const match of matches) {
        const selfScore = cosine(vector, embedTextVectors[match.index] ?? [])
        let better = 0
        for (let index = 0; index < embedTextVectors.length; index++) {
            if (index === match.index) continue
            if (cosine(vector, embedTextVectors[index] ?? []) > selfScore) better++
        }
        if (selfScore > bestScore) {
            bestScore = selfScore
            bestRank = better + 1
        }
    }

    const short = query.question.length > 24 ? `${query.question.slice(0, 24)}…` : query.question
    console.log(`| ${short} | ${query.expectSources.join(' / ')} | #${bestRank} | ${bestScore.toFixed(4)} |`)
})
