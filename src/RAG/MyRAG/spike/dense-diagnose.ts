/**
 * 诊断 dense 分数压缩的根因。
 *
 * 现象：同一问句下所有 chunk 的余弦都在 0.40 附近（极差 0.0035），排序近乎噪声。
 *
 * 三个候选原因，本探针一次区分：
 *   A. **元信息前缀同质化** —— embedText 里每个 chunk 都带同样的 `heading:/heading_level:/scope:` 结构，
 *      可能把所有向量拉向同一个方向。验证：只 embed content 与 embed 完整 embedText 对比。
 *   B. **embedding 各向异性（cone effect）** —— 模型把向量都映射进一个窄锥，
 *      于是任意两块之间的余弦本身就很高，差异被压平。验证：算块与块之间的基线余弦。
 *   C. **维度不足** —— 1024 维表达力不够。本探针先不测（要重灌，成本高），
 *      等 A/B 有结论再决定。
 *
 * 中心化的验证不需要额外调用 API：在已取回的向量上减掉均值向量再归一化即可。
 *
 * 运行：tsx --env-file=../rag-chunk/.env spike/dense-diagnose.ts
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseFile } from '../src/parse/index.js'
import { documentToChunks } from '../src/chunk/index.js'
import { embedTexts } from '../src/embed/index.js'

const DATA_DIR = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/Milvus/data'
const DIMENSIONS = 1024
/** 样本 chunk 数。中心化需要估计均值向量，样本太少均值不可信 */
const SAMPLE_SIZE = 64

const QUESTIONS: Array<{ question: string; expect: string }> = [
    { question: '怎么判断一个变量的具体类型', expect: 'typings/typeGuard.md' },
    { question: 'TypeScript 里怎么把 union 转成 intersection', expect: 'tips/infer.md' },
    { question: '柯里化是怎么实现的', expect: 'tips/curry.md' },
    { question: '协变和逆变是什么意思', expect: 'tips/covarianceAndContravariance.md' },
]

function walk(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'jsx') continue
        const path = join(dir, entry.name)
        if (entry.isDirectory()) out.push(...walk(path))
        else if (/\.md$/i.test(entry.name)) out.push(path)
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

function l2normalize(vector: number[]): number[] {
    let norm = 0
    for (const value of vector) {
        norm += value * value
    }
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

interface Spread {
    min: number
    max: number
    range: number
    std: number
}

function spreadOf(values: number[]): Spread {
    const min = Math.min(...values)
    const max = Math.max(...values)
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
    return { min, max, range: max - min, std: Math.sqrt(variance) }
}

function formatSpread(spread: Spread): string {
    return `min=${spread.min.toFixed(4)} max=${spread.max.toFixed(4)} 极差=${spread.range.toFixed(4)} 标准差=${spread.std.toFixed(4)}`
}

/** 按来源取样：每个来源取最长的一个 chunk（内容更有代表性），再截到 SAMPLE_SIZE */
async function collectSamples() {
    const longestPerSource = new Map<string, { content: string; embedText: string; scope: string | null }>()

    for (const path of walk(DATA_DIR)) {
        const doc = await parseFile(path)
        const chunks = documentToChunks(doc, { category: 'diag', owner: 'diag', sourceVersion: 'v1' })
        for (const chunk of chunks) {
            // 跳过 outline 块（内容只有标题路径，不代表正常 chunk）
            if (chunk.metadata.kind !== 'text') continue
            const current = longestPerSource.get(chunk.metadata.source)
            if (!current || chunk.content.length > current.content.length) {
                longestPerSource.set(chunk.metadata.source, {
                    content: chunk.content,
                    embedText: chunk.embedText,
                    scope: chunk.metadata.scope,
                })
            }
        }
    }

    return [...longestPerSource.entries()]
        .slice(0, SAMPLE_SIZE)
        .map(([source, value]) => ({ source, ...value }))
}

const samples = await collectSamples()
const lengths = samples.map((sample) => sample.content.length)
console.log(`样本：${samples.length} 个 chunk，来自 ${new Set(samples.map((s) => s.source)).size} 个来源`)
console.log(`内容长度：${Math.min(...lengths)} ~ ${Math.max(...lengths)} 字符`)
console.log('')

// ---------------------------------------------------------------- 向量化

console.log('向量化中（content-only / embedText / 问句）…')
const contentVectors = (await embedTexts(samples.map((s) => s.content), { dimensions: DIMENSIONS })).vectors
const embedTextVectors = (await embedTexts(samples.map((s) => s.embedText), { dimensions: DIMENSIONS })).vectors
const questionVectors = (
    await embedTexts(QUESTIONS.map((item) => item.question), { dimensions: DIMENSIONS })
).vectors
console.log('完成')
console.log('')

// ---------------------------------------------------------------- A. 块间基线

console.log('=== A) 块与块之间的基线相似度（判断各向异性）===')
console.log('如果两个「无关的」chunk 之间余弦本身就有 0.4+，说明向量挤在窄锥里，')
console.log('那么 query-chunk 的 0.40 就只是基线，差异被压平。')
console.log('')

for (const [label, vectors] of [
    ['content-only', contentVectors],
    ['embedText', embedTextVectors],
] as Array<[string, number[][]]>) {
    const pairScores: number[] = []
    for (let i = 0; i < vectors.length; i++) {
        for (let j = i + 1; j < vectors.length; j++) {
            const first = vectors[i]
            const second = vectors[j]
            if (first && second) {
                pairScores.push(cosine(first, second))
            }
        }
    }
    console.log(`  ${label.padEnd(14)} 两两余弦 ${pairScores.length} 对：${formatSpread(spreadOf(pairScores))}`)
}
console.log('')

// ---------------------------------------------------------------- B/C. query 侧极差

const contentMean = meanVector(contentVectors)
const embedMean = meanVector(embedTextVectors)

console.log('=== B) 每个问句下 query-chunk 相似度极差 ===')
console.log('极差越大说明越有区分度。raw = 原始向量，centered = 减掉均值向量后归一化（模拟去各向异性）。')
console.log('')

for (let q = 0; q < QUESTIONS.length; q++) {
    const item = QUESTIONS[q]
    const questionVector = questionVectors[q]
    if (!item || !questionVector) continue

    console.log(`问句：${item.question}　（期望 ${item.expect}）`)

    const variants: Array<[string, number[], number[][]]> = [
        ['content raw', l2normalize(questionVector), contentVectors],
        ['embedText raw', l2normalize(questionVector), embedTextVectors],
        ['content centered', l2normalize(subtract(questionVector, contentMean)), contentVectors.map((v) => l2normalize(subtract(v, contentMean)))],
        ['embedText centered', l2normalize(subtract(questionVector, embedMean)), embedTextVectors.map((v) => l2normalize(subtract(v, embedMean)))],
    ]

    for (const [label, vector, candidates] of variants) {
        const scores = candidates.map((candidate) => cosine(vector, candidate))
        const spread = spreadOf(scores)
        // 用分数找 Top-1 的来源，看是否命中期望
        let bestIndex = 0
        scores.forEach((score, index) => {
            if (score > (scores[bestIndex] ?? -Infinity)) bestIndex = index
        })
        const top1 = samples[bestIndex]
        const hit = top1?.source === item.expect ? '✅' : '  '
        console.log(
            `  ${label.padEnd(20)} ${formatSpread(spread)}   Top1=${top1?.source ?? '-'} ${hit}`
        )
    }
    console.log('')
}

// ---------------------------------------------------------------- D. 元信息前缀本身的影响

console.log('=== D) 元信息前缀的「同质化」程度 ===')
console.log('把前缀单独拿去向量化，看它们彼此之间有多像（越像说明前缀越像一个固定偏置）。')
console.log('')

const prefixes = samples.map((sample) => {
    const lines = sample.embedText.split('\n')
    // embedText = 元信息前缀 + '\n' + content，前缀以 scope/heading 行开头
    const stop = lines.findIndex((line) => line.startsWith('#'))
    return (stop >= 0 ? lines.slice(0, stop) : []).join('\n').trim()
})

const nonEmpty = prefixes.filter((prefix) => prefix.length > 0)
console.log(`  带前缀的样本：${nonEmpty.length} / ${samples.length}`)
if (nonEmpty.length >= 2) {
    const prefixVectors = (await embedTexts(nonEmpty.slice(0, 64), { dimensions: DIMENSIONS })).vectors
    const prefixPairs: number[] = []
    for (let i = 0; i < prefixVectors.length; i++) {
        for (let j = i + 1; j < prefixVectors.length; j++) {
            const first = prefixVectors[i]
            const second = prefixVectors[j]
            if (first && second) prefixPairs.push(cosine(first, second))
        }
    }
    console.log(`  前缀之间两两余弦：${formatSpread(spreadOf(prefixPairs))}`)
    console.log(`  对比：样本 content 之间两两余弦见 A 节`)
}
