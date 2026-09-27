/**
 * 生成分块速览表，用于快速扫出结构性问题（不必读全量正文）。
 *
 * 产出两部分：
 *   一、6 个样本文件逐个 chunk 一览（index / kind / 大小 / 标题路径 / 内容首行）
 *   二、全语料每文件汇总 + 自动标记疑似问题
 *
 * 运行：tsx spike/export-overview.ts
 * 产出：spike/chunk-overview.md
 */
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFile } from '../src/parse/index.js'
import { DEFAULT_CHUNK_OPTIONS, documentToChunks } from '../src/chunk/index.js'
import type { Chunk } from '../src/types.js'

const DATA_DIR = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/Milvus/data'
const DOC_DIR = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/rag-chunk/documents'
const OUTPUT = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/MyRAG/spike/chunk-overview.md'

const META = { category: 'typescript-doc', owner: 'learning', sourceVersion: 'v1' }

function walk(dir: string, ext: RegExp): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) out.push(...walk(path, ext))
        else if (ext.test(entry.name)) out.push(path)
    }
    return out
}

/** 表格单元格里的内容要压成一行、转义竖线，否则会破坏表格结构 */
function cell(text: string, max = 44): string {
    const flat = text.replace(/\s+/g, ' ').trim()
    const short = flat.length > max ? `${flat.slice(0, max)}…` : flat
    return short.replace(/\|/g, '\\|')
}

function median(values: number[]): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)] ?? 0
}

interface FileStat {
    file: string
    sections: number
    chunks: number
    sizes: number[]
    tiny: number
    outlines: number
    tables: number
    max: number
}

function flagsOf(stat: FileStat): string[] {
    const flags: string[] = []
    const ratio = stat.tiny / Math.max(1, stat.chunks)
    if (stat.chunks > 20 && ratio > 0.25) flags.push('⚠ 碎片偏多')
    if (stat.chunks <= 2 && stat.sizes.reduce((a, b) => a + b, 0) > 5000) flags.push('⚠ 疑似缺标题结构（整篇成块）')
    if (stat.max > DEFAULT_CHUNK_OPTIONS.maxChunkChars) flags.push('⚠ 超上限')
    if (stat.sections === 1 && stat.chunks > 3) flags.push('无标题结构（走聚合兜底）')
    if (stat.tables > 0) flags.push(`含 ${stat.tables} 表格块`)
    if (stat.outlines > 0) flags.push(`含 ${stat.outlines} outline`)
    return flags
}

async function statOf(path: string): Promise<{ stat: FileStat; chunks: Chunk[] }> {
    const doc = await parseFile(path)
    const chunks = documentToChunks(doc, META)
    const sizes = chunks.map((c) => c.content.length)
    return {
        stat: {
            file: path.split(/[\\/]/).pop()!,
            sections: doc.sections.length,
            chunks: chunks.length,
            sizes,
            tiny: sizes.filter((s) => s < 100).length,
            outlines: chunks.filter((c) => c.metadata.kind === 'outline').length,
            tables: chunks.filter((c) => c.metadata.kind === 'table').length,
            max: Math.max(0, ...sizes),
        },
        chunks,
    }
}

// ---------------------------------------------------------- 样本文件

const samples = [
    { path: join(DATA_DIR, 'compiler', 'ast.md'), note: '典型 md：标题 + 代码块 + 表格' },
    { path: join(DATA_DIR, 'tips', 'infer.md'), note: '曾被 officeparser 压平，检查代码块完整性' },
    { path: join(DATA_DIR, 'compiler', 'emitter.md'), note: '多窗归并（outline）机制' },
    { path: join(DATA_DIR, 'tips', 'truthy.md'), note: '表格原子性' },
    { path: join(DOC_DIR, '报告.docx'), note: '无标题结构：走聚合兜底 + 6 个表格块' },
    { path: join(DOC_DIR, 'resume.pdf'), note: 'PDF 路径 + 页码溯源' },
]

const lines: string[] = []
lines.push('# MyRAG 分块结果检查单 + 速览')
lines.push('')
lines.push(`参数：\`maxChunkChars=${DEFAULT_CHUNK_OPTIONS.maxChunkChars}\`　\`chunkOverlapChars=${DEFAULT_CHUNK_OPTIONS.chunkOverlapChars}\``)
lines.push('')
lines.push('这个文件两部分：**先看第 0 节的检查清单**，再带着清单看后面三节的数据。')
lines.push('要看某个 chunk 的完整文本，去同目录的 `chunk-samples.md`。')
lines.push('')
lines.push('## 0. 检查清单')
lines.push('')
lines.push('| # | 检查项 | 正确表现 | 异常信号 | 调哪个文件 |')
lines.push('|---|---|---|---|---|')
lines.push('| 1 | 语义完整 | 一个 chunk 自成一个可读懂的小节（标题+正文） | 中间断在句子或代码里 | `src/chunk/index.ts` 的 `DEFAULT_CHUNK_OPTIONS` |')
lines.push('| 2 | 标题路径 | `scope` 是「父 > 子」，与文档结构一致 | 原文有标题但 scope 为空，或层级错乱 | `src/parse/markdown.ts` 的标题栈 |')
lines.push('| 3 | 元信息进向量文本 | `embedText` 前 3 行是 `heading:` / `heading_level:` / `scope:` | 没有这些前缀（标题就不参与语义匹配） | `src/chunk/text.ts` |')
lines.push('| 4 | 代码块完整 | 代码 fence 配平 ✅、多行保留、语言标记在 | ❌ 不配平；代码被压成一行 | `src/chunk/window.ts` 的 fence 修补 |')
lines.push('| 5 | 表格原子性 | 表格单独成块、以 `\\|` 开头、表头+分隔行+数据行齐全 | 表格与正文混排；表头被切走 | `src/chunk/table.ts` |')
lines.push('| 6 | outline 块 | 只有标题路径、无正文，用于让纯标题也能被检索命中 | 数量太多，把检索结果冲淡 | `src/chunk/index.ts` 的 outline 分支 |')
lines.push('| 7 | 短块 | 原文本身就短的完整小节 | 大量无意义的碎片 | 见第三节逐条清单 |')
lines.push('| 8 | 无标题文档 | 全部内容落进 1 个 section，再靠滑窗聚合 | 被切成逐段落碎片 | `src/parse/ast.ts` 的兜底 |')
lines.push('')
lines.push('**需要人主观判断的只有 3 条**（机械项都已预检通过）：')
lines.push('')
lines.push('1. **outline 块要不要留** —— 会让一个多窗 section 多出一条「只有标题路径」的检索结果（靠 `group` 归并）。好处：纯标题也能被语义检索命中；代价：结果多一条噪音。看第一节 `ast.md` / `emitter.md` 的那两行。')
lines.push('2. **`resume.pdf` 整篇变成 1 个 2032 字符的 chunk** 是否可接受。若你认为一页简历该按「教育背景 / 技能特长 / 项目经历」拆细，需要新增策略。')
lines.push('3. **切分粒度** —— 现在中位 393 字符，单位是「一个标题下的小节」。若想让相邻小节合并，需要新增「兄弟 section 合并」策略（当前没有，zg 也没有）。')
lines.push('')
lines.push('## 一、样本文件逐个 chunk 一览')
lines.push('')

for (const sample of samples) {
    let result: Awaited<ReturnType<typeof statOf>>
    try {
        result = await statOf(sample.path)
    } catch (error) {
        lines.push(`### ${sample.path.split(/[\\/]/).pop()}`)
        lines.push('')
        lines.push(`解析失败：${(error as Error).message}`)
        lines.push('')
        continue
    }

    const { stat, chunks } = result
    lines.push(`### ${stat.file}`)
    lines.push('')
    lines.push(`${sample.note}　—　sections ${stat.sections}　chunks ${stat.chunks}`)
    lines.push('')
    lines.push('| # | kind | 字符 | scope（标题路径） | heading | 内容首行 |')
    lines.push('|---|---|---|---|---|---|')
    chunks.forEach((chunk, i) => {
        const meta = chunk.metadata
        lines.push(
            `| ${i + 1} | ${meta.kind} | ${meta.chunkLength} | ${meta.scope ? cell(meta.scope, 26) : '—'} | ${
                meta.heading ? cell(meta.heading, 20) : '—'
            } | ${cell(chunk.content.split('\n')[0] ?? '', 44)} |`
        )
    })
    lines.push('')
}

// ---------------------------------------------------------- 全语料汇总

const mdFiles = walk(DATA_DIR, /\.md$/i).filter((f) => !/[\\/]jsx[\\/]/.test(f))
const stats: FileStat[] = []
const allSizes: number[] = []
const tinyChunks: Array<{ file: string; index: number; chunk: Chunk }> = []

for (const path of mdFiles) {
    try {
        const { stat, chunks } = await statOf(path)
        stats.push(stat)
        allSizes.push(...stat.sizes)
        chunks.forEach((chunk, i) => {
            if (chunk.content.length < 100) {
                tinyChunks.push({ file: stat.file, index: i + 1, chunk })
            }
        })
    } catch {
        /* 忽略 */
    }
}

lines.push('## 二、全语料每文件汇总（找离群文件）')
lines.push('')
lines.push(`看「标记」列有没有 \`⚠\`。合计：${stats.length} 篇　${allSizes.length} 个 chunk　中位 ${median(allSizes)} 字符　<100 字符占比 ${(
    (allSizes.filter((s) => s < 100).length / Math.max(1, allSizes.length)) *
    100
).toFixed(1)}%`)
lines.push('')
lines.push('| 文件 | sections | chunks | 中位 | 最小 | 最大 | <100 | 标记 |')
lines.push('|---|---|---|---|---|---|---|---|')

const sorted = [...stats].sort((a, b) => b.tiny / Math.max(1, b.chunks) - a.tiny / Math.max(1, a.chunks))
for (const stat of sorted) {
    lines.push(
        `| ${cell(stat.file, 30)} | ${stat.sections} | ${stat.chunks} | ${median(stat.sizes)} | ${
            Math.min(...stat.sizes)
        } | ${stat.max} | ${stat.tiny} | ${flagsOf(stat).join('；') || '—'} |`
    )
}

// ---------------------------------------------------------- 所有短块清单
// 这一步把「8% 小 chunk」这个统计数字变成可逐条判断的清单：
// 需要人工确认它们是「语义完整的短小节」还是「该被合并的碎片」。

lines.push('')
lines.push('## 三、所有小于 100 字符的 chunk 清单')
lines.push('')
lines.push(`共 ${tinyChunks.length} 个。需要判断：这些是「语义完整的小节」，还是「本该被合并进相邻块的碎片」。`)
lines.push('')
lines.push('| 文件 | # | kind | 字符 | heading | 完整内容 |')
lines.push('|---|---|---|---|---|---|')

tinyChunks
    .sort((a, b) => a.chunk.content.length - b.chunk.content.length)
    .forEach((item) => {
        lines.push(
            `| ${cell(item.file, 26)} | ${item.index} | ${item.chunk.metadata.kind} | ${item.chunk.content.length} | ${
                item.chunk.metadata.heading ? cell(item.chunk.metadata.heading, 18) : '—'
            } | ${cell(item.chunk.content, 90)} |`
        )
    })

writeFileSync(OUTPUT, lines.join('\n'), 'utf8')

console.log(`已导出：${OUTPUT}`)
console.log(`行数：${lines.length}　大小：${(lines.join('\n').length / 1024).toFixed(1)} KB`)
console.log('')
console.log(`全语料：${stats.length} 篇 / ${allSizes.length} chunk　中位 ${median(allSizes)}　<100 字符占比 ${(
    (allSizes.filter((s) => s < 100).length / Math.max(1, allSizes.length)) *
    100
).toFixed(1)}%`)
console.log('')
console.log('碎片比例最高的 8 个文件：')
for (const stat of sorted.slice(0, 8)) {
    console.log(
        `  ${stat.file.padEnd(34)} chunks=${String(stat.chunks).padStart(3)} 中位=${String(median(stat.sizes)).padStart(4)} <100=${String(
            stat.tiny
        ).padStart(3)}  ${flagsOf(stat).join('；')}`
    )
}
