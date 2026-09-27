/**
 * 导出分块结果供人工审核。
 *
 * 挑选有代表性的样本：普通 md、之前被 officeparser 压平的 infer.md、无标题的 docx、
 * PDF，以及所有会产出 outline / 表格块的 md（这些是机制最需要肉眼确认的地方）。
 *
 * 运行：tsx spike/export-chunks.ts
 * 产出：spike/chunk-samples.md
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFile } from '../src/parse/index.js'
import { DEFAULT_CHUNK_OPTIONS, documentToChunks } from '../src/chunk/index.js'
import type { Chunk, ParsedDocument } from '../src/types.js'

const DATA_DIR = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/Milvus/data'
const DOC_DIR = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/rag-chunk/documents'
const OUTPUT = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/MyRAG/spike/chunk-samples.md'

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

function fencesBalanced(content: string): boolean {
    const count = content.split('\n').filter((line) => line.trimStart().startsWith('```')).length
    return count % 2 === 0
}

/** 用 5 个反引号包裹内容，避免内容里自带的 ``` 破坏外层 fencing */
function fenceBlock(content: string): string {
    return '`````text\n' + content + '\n`````'
}

// -------------------------------------------------- 挑样本

const mdFiles = walk(DATA_DIR, /\.md$/i).filter((f) => !/[\\/]jsx[\\/]/.test(f))

interface Entry {
    path: string
    label: string
    reason: string
}

const entries: Entry[] = [
    {
        path: join(DATA_DIR, 'compiler', 'ast.md'),
        label: '典型 md（有 heading / 代码块 / 表格）',
        reason: '代表绝大多数语料的形态',
    },
    {
        path: join(DATA_DIR, 'tips', 'infer.md'),
        label: '曾被 officeparser 压平的文件',
        reason: '验证「列表内缩进的代码块」现在是否完整保留',
    },
]

// 自动找出会产生 outline / 表格块的 md，这些是最需要人工确认的
for (const path of mdFiles) {
    const fileName = path.split(/[\\/]/).pop()!
    if (entries.some((entry) => entry.path === path)) continue
    try {
        const doc = await parseFile(path)
        const chunks = documentToChunks(doc, META)
        const outlines = chunks.filter((c) => c.metadata.kind === 'outline').length
        const tables = chunks.filter((c) => c.metadata.kind === 'table').length
        if (outlines > 0 || tables > 0) {
            entries.push({
                path,
                label: `含 ${outlines} 个 outline / ${tables} 个表格块`,
                reason: '确认多窗归并与表格原子性',
            })
        }
    } catch {
        /* 忽略 */
    }
}

entries.push(
    {
        path: join(DOC_DIR, '报告.docx'),
        label: '无标题结构文档（heading 节点为 0）',
        reason: '验证无标题时按段落聚合的兜底，以及表格结构化',
    },
    {
        path: join(DOC_DIR, 'resume.pdf'),
        label: 'PDF 文档',
        reason: '验证 PDF 路径与页码溯源',
    }
)

// -------------------------------------------------- 生成报告

const lines: string[] = []
const summary: string[] = []

lines.push('# MyRAG 分块结果人工审核样本')
lines.push('')
lines.push(`参数：\`maxChunkChars=${DEFAULT_CHUNK_OPTIONS.maxChunkChars}\`，\`chunkOverlapChars=${DEFAULT_CHUNK_OPTIONS.chunkOverlapChars}\``)
lines.push('')
lines.push('每个 chunk 都列出「送去 embedding 的完整文本」，因为那才是真正参与语义匹配的内容。')
lines.push('')
lines.push('## 汇总')
lines.push('')
summary.push('| 文件 | sections | chunks | text | outline | table | 说明 |')
summary.push('|---|---|---|---|---|---|---|')

let sectionNo = 0
for (const entry of entries) {
    const fileName = entry.path.split(/[\\/]/).pop()!
    let doc: ParsedDocument
    let chunks: Chunk[]
    try {
        doc = await parseFile(entry.path)
        chunks = documentToChunks(doc, META)
    } catch (error) {
        lines.push(`## ${fileName}`)
        lines.push('')
        lines.push(`解析失败：${(error as Error).message}`)
        lines.push('')
        continue
    }

    const countOf = (kind: string) => chunks.filter((c) => c.metadata.kind === kind).length
    summary.push(
        `| \`${fileName}\` | ${doc.sections.length} | ${chunks.length} | ${countOf('text')} | ${countOf('outline')} | ${countOf('table')} | ${entry.label} |`
    )

    sectionNo++
    lines.push(`## ${sectionNo}. ${fileName}`)
    lines.push('')
    lines.push(`- 说明：${entry.label} —— ${entry.reason}`)
    lines.push(`- 格式：\`${doc.format}\`　文档标题：\`${doc.title}\``)
    lines.push(`- sections：${doc.sections.length}　chunks：${chunks.length}`)
    if (doc.warnings.length > 0) {
        lines.push(`- 解析警告：${doc.warnings.slice(0, 3).join(' / ')}`)
    }
    lines.push('')

    chunks.forEach((chunk, i) => {
        const meta = chunk.metadata
        const balanced = fencesBalanced(chunk.content)
        lines.push(`### chunk ${i + 1} / ${chunks.length}　\`${meta.kind}\`　${meta.chunkLength} 字符`)
        lines.push('')
        lines.push(`- id：\`${chunk.id}\``)
        lines.push(`- scope（标题路径）：${meta.scope ? `\`${meta.scope}\`` : '（无）'}`)
        lines.push(`- heading：${meta.heading ? `\`${meta.heading}\`（level ${meta.headingLevel}）` : '（无）'}`)
        lines.push(`- group：${meta.group ? `\`${meta.group}\`` : '（无）'}`)
        lines.push(`- 代码 fence 配平：${balanced ? '✅' : '❌ 不配平'}`)
        if (meta.pageNumbers.length > 0) {
            lines.push(`- 页码：${JSON.stringify(meta.pageNumbers)}`)
        }
        lines.push('')
        lines.push('<details><summary>送去 embedding 的完整文本</summary>')
        lines.push('')
        lines.push(fenceBlock(chunk.embedText))
        lines.push('')
        lines.push('</details>')
        lines.push('')
    })
}

const header = lines.slice(0, 5)
const body = lines.slice(5)
const output = [...header, ...summary, '', ...body].join('\n')
writeFileSync(OUTPUT, output, 'utf8')

console.log(`已导出：${OUTPUT}`)
console.log(`文件数：${entries.length}　总大小：${(output.length / 1024).toFixed(1)} KB`)
console.log('')
console.log(summary.join('\n'))
console.log('')
console.log('样本文件清单：')
for (const entry of entries) {
    console.log(`  - ${entry.path.split(/[\\/]/).pop()}  （${entry.label}）`)
}
