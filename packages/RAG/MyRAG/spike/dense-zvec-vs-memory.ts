/**
 * 对拍：Zvec 的 dense 检索 vs 内存里直接算的相似度，确定 Zvec 实际用的度量。
 *
 * 触发原因：内存评测显示 dense 的 hit@1 是 8/11（种子集），而走 Zvec 的评测 hit@10 只有 36.4%；
 * 两者分数完全对不上（内存余弦 0.52~0.74，Zvec ~0.40）。差异在 Zvec 查询路径。
 *
 * 排查顺序：
 *   1. 库里存的向量，是否等于现场重算的同一段文本的向量
 *   2. 对每个命中，用「存储向量」分别算 cosine 与 IP，看哪一个等于 Zvec 报告的 score
 *      —— 这一步直接确定 Zvec 用的是哪种度量
 *
 * 运行：tsx --env-file=../rag-chunk/.env spike/dense-zvec-vs-memory.ts
 */
import { resolve } from 'node:path'
import { ZVecOpen } from '@zvec/zvec'
import { parseFile } from '../src/parse/index.js'
import { documentToChunks } from '../src/chunk/index.js'
import { embedTexts } from '../src/embed/index.js'
import { QUERY_OUTPUT_FIELDS, dimensionOf } from '../src/query/index.js'

const DB = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/MyRAG/zvec-data/myrag'
const DATA_DIR = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/Milvus/data'
const DIMENSIONS = 1024

const QUESTIONS = [
    '柯里化是怎么实现的',
    'TypeScript 里怎么把 union 转成 intersection',
]

function dot(first: number[], second: number[]): number {
    let sum = 0
    for (let index = 0; index < first.length; index++) {
        sum += (first[index] ?? 0) * (second[index] ?? 0)
    }
    return sum
}

function norm(vector: number[]): number {
    return Math.sqrt(dot(vector, vector))
}

function cosine(first: number[], second: number[]): number {
    const denominator = norm(first) * norm(second)
    return denominator === 0 ? 0 : dot(first, second) / denominator
}

const collection = ZVecOpen(resolve(DB))
const vectorField = collection.schema.vectors().find((field) => field.name === 'embedding')
console.log(`collection：文档数 ${collection.stats.docCount}　维度 ${dimensionOf(collection)}`)
console.log(`向量字段 indexParams：${JSON.stringify(vectorField?.indexParams)}`)
console.log('')

/** 取一批 id 的存储向量 */
function storedVectorsOf(ids: string[]): Map<string, number[]> {
    const out = new Map<string, number[]>()
    if (ids.length === 0) return out
    const fetched = collection.fetchSync({ ids, includeVector: true })
    for (const id of ids) {
        const entry = fetched[id] as { vectors?: Record<string, number[]> } | undefined
        const vector = entry?.vectors?.embedding
        if (Array.isArray(vector)) {
            out.set(id, vector)
        }
    }
    return out
}

// ---------------------------------------------------------------- 1) 存储向量 vs 现场向量

console.log('=== 1) 存储向量 是否等于 现场重算的向量 ===')
console.log('')

const TARGET_SOURCE = 'tips/curry.md'
const questionVector = (await embedTexts([QUESTIONS[0] ?? ''], { dimensions: DIMENSIONS })).vectors[0]

if (questionVector) {
    console.log(`问句向量：L2 范数=${norm(questionVector).toFixed(6)}（不等于 1 说明向量未归一化）`)
}

const targetDocs = collection.querySync({
    fieldName: 'embedding',
    vector: questionVector ?? new Array<number>(DIMENSIONS).fill(0.01),
    topk: 20,
    filter: `source = '${TARGET_SOURCE}'`,
    outputFields: ['source', 'chunkIndex'],
})
console.log(`${TARGET_SOURCE} 在库里有 ${targetDocs.length} 个 chunk`)

const stored = storedVectorsOf(targetDocs.map((doc) => doc.id))
for (const [id, vector] of stored) {
    console.log(`  id=${id}　维度=${vector.length}　L2 范数=${norm(vector).toFixed(6)}　前 3 分量=[${vector.slice(0, 3).map((v) => v.toFixed(5)).join(', ')}]`)
}

const doc = await parseFile(`${DATA_DIR}/tips/curry.md`)
const freshChunks = documentToChunks(doc, {
    category: 'x',
    owner: 'y',
    sourceVersion: 'v1',
    source: TARGET_SOURCE,
})
const freshVectors = (await embedTexts(freshChunks.map((chunk) => chunk.embedText), { dimensions: DIMENSIONS })).vectors
console.log(`现场生成 ${freshChunks.length} 个 chunk：`)
freshChunks.forEach((chunk, index) => {
    const vector = freshVectors[index]
    console.log(
        `  id=${chunk.id}　L2 范数=${vector ? norm(vector).toFixed(6) : 'n/a'}　前 3 分量=[${(vector ?? []).slice(0, 3).map((v) => v.toFixed(5)).join(', ')}]`
    )
})

const firstStored = stored.get(targetDocs[0]?.id ?? '')
const firstFresh = freshVectors[0]
if (firstStored && firstFresh) {
    console.log('')
    console.log(`  存储向量 vs 现场向量：cosine=${cosine(firstStored, firstFresh).toFixed(8)}　dot=${dot(firstStored, firstFresh).toFixed(6)}`)
    console.log('  （cosine 接近 1 说明库里存的就是这段文本的向量）')
}
console.log('')

// ---------------------------------------------------------------- 2) Zvec score 是什么度量

console.log('=== 2) Zvec 的 score 对应哪种度量 ===')
console.log('')
console.log('| 问句 | 排名 | Zvec score | 用存储向量算 cosine | 用存储向量算 IP | 匹配 |')
console.log('|---|---|---|---|---|---|')

for (const question of QUESTIONS) {
    const vector = (await embedTexts([question], { dimensions: DIMENSIONS })).vectors[0]
    if (!vector) continue

    const docs = collection.querySync({
        fieldName: 'embedding',
        vector,
        topk: 5,
        outputFields: QUERY_OUTPUT_FIELDS,
    })
    const vectorsById = storedVectorsOf(docs.map((doc) => doc.id))

    docs.forEach((docHit, position) => {
        const storedVector = vectorsById.get(docHit.id)
        const cos = storedVector ? cosine(vector, storedVector) : Number.NaN
        const ip = storedVector ? dot(vector, storedVector) : Number.NaN
        const matchesCosine = Math.abs(cos - docHit.score) < 1e-4
        const matchesIp = Math.abs(ip - docHit.score) < 1e-4
        const match = matchesCosine ? 'cosine' : matchesIp ? 'IP' : '都不是'
        const short = question.length > 18 ? `${question.slice(0, 18)}…` : question
        console.log(
            `| ${short} | ${position + 1} | ${docHit.score.toFixed(6)} | ${cos.toFixed(6)} | ${ip.toFixed(6)} | ${match} |`
        )
    })
    console.log('')
}

console.log('=== 附：同一问句下 Zvec Top-5 的来源 ===')
for (const question of QUESTIONS) {
    const vector = (await embedTexts([question], { dimensions: DIMENSIONS })).vectors[0]
    if (!vector) continue
    const docs = collection.querySync({
        fieldName: 'embedding',
        vector,
        topk: 5,
        outputFields: QUERY_OUTPUT_FIELDS,
    })
    console.log(`  ${question}`)
    for (const docHit of docs) {
        console.log(`    score=${docHit.score.toFixed(6)}　${String(docHit.fields.source)}　chunk#${String(docHit.fields.chunkIndex)}`)
    }
}

collection.closeSync()
