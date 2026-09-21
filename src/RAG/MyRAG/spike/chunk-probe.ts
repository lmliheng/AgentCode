/**
 * 验证分块实现：在同一批真实语料上对比「旧实现（120 字符）」和「新实现（3600/540）」。
 *
 * 检查项：
 *   1. chunk 大小分布 —— 新实现不应再产出 120 字符级的碎片
 *   2. 代码块完整性 —— 不应出现 fence 数量为奇数的 chunk（说明代码块被劈开）
 *   3. breadcrumb 是否正确落在元信息与向量文本里
 *   4. 无标题文档（报告.docx）是否被聚合而不是切成逐段碎片
 *   5. 表格是否单独成块且行未被切碎
 *
 * 运行：tsx spike/chunk-probe.ts
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseFile } from '../src/parse/index.js'
import { DEFAULT_CHUNK_OPTIONS, documentToChunks } from '../src/chunk/index.js'
import type { Chunk } from '../src/types.js'

const DATA_DIR = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/Milvus/data'
const META = { category: 'typescript-doc', owner: 'learning', sourceVersion: 'v1' }

function walk(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) out.push(...walk(path))
        else if (/\.md$/i.test(entry.name)) out.push(path)
    }
    return out
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
}

function summarize(label: string, sizes: number[]) {
    const tiny = sizes.filter((s) => s < 100).length
    console.log(
        `${label.padEnd(22)} 数量=${String(sizes.length).padStart(5)}  ` +
            `中位=${String(percentile(sizes, 0.5)).padStart(5)}  ` +
            `p10=${String(percentile(sizes, 0.1)).padStart(4)}  ` +
            `最大=${String(Math.max(0, ...sizes)).padStart(5)}  ` +
            `<100字符=${tiny} (${((tiny / Math.max(1, sizes.length)) * 100).toFixed(1)}%)`
    )
}

/** 统计 fence 数量，奇数说明代码块被劈开了 */
function hasBrokenCodeFence(content: string): boolean {
    const fences = content.split('\n').filter((line) => line.trimStart().startsWith('```')).length
    return fences % 2 !== 0
}

const brokenExamples: Array<{ id: string; length: number; head: string }> = []

// ---------------------------------------------------------------- 全语料对比

const files = walk(DATA_DIR).filter((f) => !/[\\/]jsx[\\/]/.test(f))
console.log(`语料：${files.length} 篇 md（已排除 jsx 重复目录）`)
console.log('')

// 旧实现：动态引入，失败则不对比
let oldChunker: ((fileName: string, content: string) => any[]) | null = null
try {
    const mod = await import('../../rag-chunk/src/chunk/markdown/index.js')
    oldChunker = mod.markdown_chunk
} catch (error) {
    console.log(`（无法加载旧实现做对比：${(error as Error).message}）`)
}

const oldSizes: number[] = []
const newSizes: number[] = []
let newTotal = 0
let parseFailures = 0
const kindCounts = new Map<string, number>()
let brokenFences = 0
let originalChars = 0

interface Failure {
    file: string
    message: string
}
const failures: Failure[] = []

const perFile: Array<{ file: string; oldCount: number; newCount: number; sections: number }> = []

for (const path of files) {
    const fileName = path.split(/[\\/]/).pop()!
    const original = readFileSync(path, 'utf8')
    originalChars += original.length

    if (oldChunker) {
        try {
            const chunks = oldChunker(fileName, original)
            oldSizes.push(...chunks.map((c: any) => String(c.content ?? '').length))
        } catch {
            /* 旧实现对某些文件可能抛错，忽略 */
        }
    }

    try {
        const doc = await parseFile(path)
        const chunks = documentToChunks(doc, META)
        newSizes.push(...chunks.map((c) => c.content.length))
        newTotal += chunks.length
        for (const chunk of chunks) {
            kindCounts.set(chunk.metadata.kind, (kindCounts.get(chunk.metadata.kind) ?? 0) + 1)
            if (hasBrokenCodeFence(chunk.content)) {
                brokenFences++
                if (brokenExamples.length < 5) {
                    brokenExamples.push({
                        id: chunk.id,
                        length: chunk.content.length,
                        head: chunk.content.slice(0, 120).replace(/\n/g, ' ⏎ '),
                    })
                }
            }
        }
        perFile.push({ file: fileName, oldCount: 0, newCount: chunks.length, sections: doc.sections.length })
    } catch (error) {
        parseFailures++
        failures.push({ file: fileName, message: (error as Error).message.slice(0, 120) })
    }
}

console.log('=== 分块大小分布 ===')
if (oldSizes.length > 0) summarize('旧实现(120/40)', oldSizes)
summarize('新实现(3600/540)', newSizes)
console.log('')
console.log(`新实现 chunk 总数：${newTotal}`)
console.log(`chunk 类型分布：${[...kindCounts.entries()].map(([k, v]) => `${k}×${v}`).join('  ')}`)
console.log(`原文总字符：${originalChars}（chunk 内容总计含 overlap，会略高于此）`)
console.log(`代码块被劈开的 chunk：${brokenFences} 个（应为 0）`)
for (const example of brokenExamples) {
    console.log(`    ✗ ${example.id} (${example.length} 字符) ${example.head}`)
}
console.log(`解析失败文件：${parseFailures} 个`)
for (const failure of failures.slice(0, 5)) {
    console.log(`    ✗ ${failure.file}: ${failure.message}`)
}
console.log('')

// ---------------------------------------------------------------- 抽样细节

const SAMPLE = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/Milvus/data/compiler/ast.md'
const sampleDoc = await parseFile(SAMPLE)
const sampleChunks = documentToChunks(sampleDoc, META)

console.log('=== 抽样：compiler/ast.md ===')
console.log(`sections=${sampleDoc.sections.length}  chunks=${sampleChunks.length}`)
console.log('')
for (const chunk of sampleChunks.slice(0, 6)) {
    console.log(`--- [${chunk.metadata.kind}] ${chunk.content.length} 字符  id=${chunk.id}`)
    console.log(`    scope=${JSON.stringify(chunk.metadata.scope)}  heading=${JSON.stringify(chunk.metadata.heading)}  group=${chunk.metadata.group}`)
    console.log(`    内容首行: ${(chunk.content.split('\n')[0] ?? '').slice(0, 80)}`)
}
console.log('')
console.log('--- 一个 chunk 送去 embedding 的完整文本（前 500 字符）---')
console.log(sampleChunks[1]?.embedText.slice(0, 500))
console.log('')

// ---------------------------------------------------------------- 无标题文档

const DOCX = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/rag-chunk/documents/报告.docx'
try {
    const doc = await parseFile(DOCX)
    const chunks = documentToChunks(doc, { ...META, category: 'report' })
    const sizes = chunks.map((c) => c.content.length)
    console.log('=== 无标题文档：报告.docx（officeparser 的 heading 节点为 0）===')
    console.log(`sections=${doc.sections.length}（应为 1，全部内容落在无标题 section）`)
    console.log(`chunks=${chunks.length}`)
    console.log(`大小：中位=${percentile(sizes, 0.5)} 最大=${Math.max(0, ...sizes)} 最小=${Math.min(...sizes)}`)
    console.log(`表格块：${chunks.filter((c) => c.metadata.kind === 'table').length} 个`)
    console.log(`超长块（>3600）：${sizes.filter((s) => s > 3600).length} 个`)
    console.log('')
    const tableChunk = chunks.find((c) => c.metadata.kind === 'table')
    if (tableChunk) {
        console.log('--- 表格块抽样（前 400 字符）---')
        console.log(tableChunk.content.slice(0, 400))
    }
} catch (error) {
    console.log(`报告.docx 处理失败：${(error as Error).message.slice(0, 200)}`)
}
console.log('')

// ---------------------------------------------------------------- PDF

const PDF = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/rag-chunk/documents/resume.pdf'
try {
    const doc = await parseFile(PDF)
    const chunks = documentToChunks(doc, { ...META, category: 'resume' })
    console.log('=== resume.pdf ===')
    console.log(`sections=${doc.sections.length}  chunks=${chunks.length}`)
    console.log(`页码是否记录：${JSON.stringify(chunks[0]?.metadata.pageNumbers ?? [])}`)
    console.log(`大小：中位=${percentile(chunks.map((c) => c.content.length), 0.5)} 最大=${Math.max(...chunks.map((c) => c.content.length))}`)
    console.log('')
    console.log('--- 首个 chunk ---')
    console.log(chunks[0]?.content.slice(0, 300))
} catch (error) {
    console.log(`resume.pdf 处理失败：${(error as Error).message.slice(0, 200)}`)
}
