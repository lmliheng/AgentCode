import type { Chunk, ParsedDocument } from './types.js'

/**
 * 分块报告渲染。
 *
 * 用途有两个：
 *   1. CLI 的 `--export` 输出，供人工审核切分质量
 *   2. 直接核对某个 chunk 送去 embedding 的完整文本
 *
 * 关键是必须输出 embedText 而不只是 content —— 真正参与语义匹配的是 embedText。
 */

export interface FileReport {
    path: string
    doc: ParsedDocument
    chunks: Chunk[]
}

/** 用 5 个反引号包裹，避免内容自带的 ``` 破坏外层 fencing */
function fenceBlock(content: string): string {
    return '`````text\n' + content + '\n`````'
}

function cell(text: string, max: number): string {
    const flat = text.replace(/\s+/g, ' ').trim()
    return (flat.length > max ? `${flat.slice(0, max)}…` : flat).replace(/\|/g, '\\|')
}

function fencesBalanced(content: string): boolean {
    const count = content.split('\n').filter((line) => line.trimStart().startsWith('```')).length
    return count % 2 === 0
}

function median(values: number[]): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** 每文件一行汇总，用于快速找离群文件 */
export function renderSummaryTable(reports: FileReport[]): string {
    const lines = ['| 文件 | sections | chunks | 中位 | p10 | 最大 | <100字符 | outline | table |', '|---|---|---|---|---|---|---|---|---|']

    for (const report of reports) {
        const sizes = report.chunks.map((chunk) => chunk.content.length)
        const sorted = [...sizes].sort((a, b) => a - b)
        const countOf = (kind: string) => report.chunks.filter((chunk) => chunk.metadata.kind === kind).length
        lines.push(
            `| ${cell(report.doc.fileName, 30)} | ${report.doc.sections.length} | ${report.chunks.length} | ${median(sizes)} | ${
                sorted[Math.floor(sorted.length * 0.1)] ?? 0
            } | ${Math.max(0, ...sizes)} | ${sizes.filter((size) => size < 100).length} | ${countOf('outline')} | ${countOf('table')} |`
        )
    }
    return lines.join('\n')
}

/** 一个文件的全部 chunk 明细 */
export function renderChunks(report: FileReport, headingLevel = 3): string {
    const hash = '#'.repeat(headingLevel)
    const lines: string[] = []

    lines.push(`${hash} ${report.doc.fileName}`)
    lines.push('')
    lines.push(
        `格式 \`${report.doc.format}\`　标题 \`${report.doc.title}\`　sections ${report.doc.sections.length}　chunks ${report.chunks.length}`
    )
    if (report.doc.frontMatter) {
        const pairs = Object.entries(report.doc.frontMatter)
            .map(([key, value]) => `${key}=${value}`)
            .join('　')
        lines.push(`文档头 front-matter：${pairs}`)
    }
    if (report.doc.warnings.length > 0) {
        lines.push(`解析警告：${report.doc.warnings.slice(0, 3).join(' / ')}`)
    }
    lines.push('')

    report.chunks.forEach((chunk, index) => {
        const meta = chunk.metadata
        lines.push(`${'#'.repeat(headingLevel + 1)} chunk ${index + 1} / ${report.chunks.length}　\`${meta.kind}\`　${meta.chunkLength} 字符`)
        lines.push('')
        lines.push(`- id：\`${chunk.id}\``)
        lines.push(`- 元信息：category \`${meta.category}\`　owner \`${meta.owner}\`　version \`${meta.sourceVersion}\``)
        lines.push(`- scope（标题路径）：${meta.scope ? `\`${meta.scope}\`` : '（无）'}`)
        lines.push(`- heading：${meta.heading ? `\`${meta.heading}\`（level ${meta.headingLevel}）` : '（无）'}`)
        lines.push(`- group：${meta.group ? `\`${meta.group}\`` : '（无）'}`)
        lines.push(`- 代码 fence 配平：${fencesBalanced(chunk.content) ? '✅' : '❌ 不配平'}`)
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

    return lines.join('\n')
}

export function renderReport(reports: FileReport[], title: string, options: { maxChunkChars: number; chunkOverlapChars: number }): string {
    const allSizes = reports.flatMap((report) => report.chunks.map((chunk) => chunk.content.length))

    const header = [
        `# ${title}`,
        '',
        `参数：\`maxChunkChars=${options.maxChunkChars}\`　\`chunkOverlapChars=${options.chunkOverlapChars}\``,
        '',
        `合计：${reports.length} 个文件　${allSizes.length} 个 chunk　中位 ${median(allSizes)} 字符　<100 字符 ${
            allSizes.filter((size) => size < 100).length
        } 个（${((allSizes.filter((size) => size < 100).length / Math.max(1, allSizes.length)) * 100).toFixed(1)}%）`,
        '',
        '## 每文件汇总',
        '',
        renderSummaryTable(reports),
        '',
        '## 逐 chunk 明细',
        '',
    ]

    const body = reports.map((report) => renderChunks(report)).join('\n')
    return [...header, body].join('\n')
}
