import { readFileSync } from 'node:fs'
import type { ParsedDocument, Run, Section, TableData, TextUnit } from '../types.js'
import { extractFrontMatter } from './frontmatter.js'
import { collectSectionText, describeResidual, findResidualCompat, normalizeText } from './normalize.js'

/**
 * markdown 自研解析：原始文本 → Section 数组。
 *
 * 为什么 md 不走 officeparser：实测它对「缩进在列表内的 fenced code block」解析失败，
 * 会把代码块压成单行 paragraph 并丢失换行（见 spike/md-loss-probe.ts，
 * infer.md 15 个代码块中 14 个被压平）。而 md 是纯文本、我们能精确解析，
 * 所以这里保留原始行，只做「按标题切 section」和「轻度分类成单元」，
 * 代码块内容逐字保留，没有任何有损重建。
 *
 * 标题扫描逻辑移植自 zg 的 scanHeadings：fence 内的 # 不当作标题，
 * 同时支持 ATX（# x）与 setext（下一行是 === 或 ---）两种写法。
 */

interface Heading {
    level: number
    text: string
    /** 标题最后一行的下标（setext 占两行） */
    endLineIndex: number
}

function scanHeadings(lines: string[]): Heading[] {
    const headings: Heading[] = []
    let fence: string | null = null

    for (let index = 0; index < lines.length; index++) {
        // 循环上界保证 index 有效；?? '' 只是收窄类型，不改变行为
        const line = lines[index] ?? ''
        const trimmed = line.trimStart()

        if (fence) {
            if (trimmed.startsWith(fence)) {
                fence = null
            }
            continue
        }

        const fenceMatch = trimmed.match(/^(```+|~~~+)/)
        const fenceMarker = fenceMatch?.[1]
        if (fenceMarker !== undefined) {
            fence = fenceMarker
            continue
        }

        const atx = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
        const atxLevel = atx?.[1]
        const atxText = atx?.[2]
        if (atxLevel !== undefined && atxText !== undefined) {
            headings.push({ level: atxLevel.length, text: atxText.trim(), endLineIndex: index })
            continue
        }

        const next = lines[index + 1]?.trim()
        if (line.trim().length > 0 && next && /^(=+|-+)\s*$/.test(next)) {
            headings.push({
                level: next.startsWith('=') ? 1 : 2,
                text: line.trim(),
                endLineIndex: index + 1,
            })
            index++
        }
    }

    return headings
}

const LIST_ITEM = /^\s*([-*+]|\d+\.)\s+/
const TABLE_ROW = /^\s*\|/

function isTableStart(lines: string[], index: number): boolean {
    if (!TABLE_ROW.test(lines[index] ?? '')) {
        return false
    }
    const next = (lines[index + 1] ?? '').trim()
    return /^\|[\s:|\-]+\|?$/.test(next) && next.includes('-')
}

function splitTableRow(line: string): string[] {
    const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
    return trimmed.split('|').map((cell) => cell.trim())
}

function readTable(lines: string[], start: number): { table: TableData; next: number } {
    const rows: string[][] = []
    let index = start

    while (index < lines.length && TABLE_ROW.test(lines[index] ?? '')) {
        const cells = splitTableRow(lines[index] ?? '')
        // 跳过 |---|---| 这一类分隔行
        if (!cells.every((cell) => /^:?-{2,}:?$/.test(cell))) {
            rows.push(cells)
        }
        index++
    }

    return { table: { header: rows[0] ?? [], rows: rows.slice(1) }, next: index }
}

/** 把一段原始行（不含标题行）拆成有序的 Run 列表 */
function linesToRuns(lines: string[]): Run[] {
    const runs: Run[] = []
    let units: TextUnit[] = []
    let paragraph: string[] = []

    const flushParagraph = () => {
        if (paragraph.length > 0) {
            units.push({ kind: 'paragraph', text: paragraph.join('\n') })
            paragraph = []
        }
    }

    const flushUnits = () => {
        flushParagraph()
        if (units.length > 0) {
            runs.push({ kind: 'text', units })
            units = []
        }
    }

    let index = 0
    while (index < lines.length) {
        // 循环上界保证 index 有效；?? '' 只是收窄类型，不改变行为
        const line = lines[index] ?? ''

        // ---- fenced code block：内容逐字保留
        const fenceMatch = line.match(/^\s*(```+|~~~+)\s*(\S*)/)
        const marker = fenceMatch?.[1]
        if (marker !== undefined) {
            flushParagraph()
            const language = fenceMatch?.[2] || undefined
            const body: string[] = []

            index++
            while (index < lines.length) {
                const bodyLine = lines[index] ?? ''
                if (bodyLine.trimStart().startsWith(marker)) {
                    break
                }
                body.push(bodyLine)
                index++
            }
            index++ // 跳过结束 fence

            units.push({ kind: 'code', text: body.join('\n'), language })
            continue
        }

        // ---- 表格：单独成为一个 Run，保证不被切碎
        if (isTableStart(lines, index)) {
            flushUnits()
            const { table, next } = readTable(lines, index)
            runs.push({ kind: 'table', table })
            index = next
            continue
        }

        // ---- 列表：连续列表项（含缩进续行）合成一个单元
        if (LIST_ITEM.test(line)) {
            flushParagraph()
            const items: string[] = []
            while (index < lines.length) {
                const current = lines[index] ?? ''
                if (LIST_ITEM.test(current)) {
                    items.push(current.replace(/^\s+/, (spaces) => '  '.repeat(Math.floor(spaces.length / 2))))
                    index++
                    continue
                }
                // 缩进续行属于同一个列表项
                if (current.trim() !== '' && /^\s+/.test(current)) {
                    items.push(current)
                    index++
                    continue
                }
                break
            }
            units.push({ kind: 'list', text: items.join('\n') })
            continue
        }

        if (line.trim() === '') {
            flushParagraph()
            index++
            continue
        }

        paragraph.push(line.trim())
        index++
    }

    flushUnits()
    return runs
}

export function markdownToSections(input: string | string[]): Section[] {
    // 允许直接传已经切好的行（front-matter 提取会返回行数组，避免再 join/split 一遍）
    const lines = Array.isArray(input) ? input : input.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n')
    const headings = scanHeadings(lines)
    const sections: Section[] = []
    const stack: Array<{ level: number; text: string }> = []

    // 计算每个 section 的行范围；标题行本身不进内容（buildLineStream 会重新加上）
    const bounds: Array<{ heading: Heading | null; start: number; end: number; breadcrumb: string[] }> = []

    const firstHeading = headings[0]
    if (!firstHeading) {
        bounds.push({ heading: null, start: 0, end: lines.length - 1, breadcrumb: [] })
    } else {
        if (firstHeading.endLineIndex + 1 > 0 && lines.slice(0, firstHeading.endLineIndex).join('\n').trim()) {
            bounds.push({ heading: null, start: 0, end: firstHeading.endLineIndex - 1, breadcrumb: [] })
        }
        headings.forEach((heading, i) => {
            let parent = stack[stack.length - 1]
            while (parent && parent.level >= heading.level) {
                stack.pop()
                parent = stack[stack.length - 1]
            }
            bounds.push({
                heading,
                start: heading.endLineIndex + 1,
                end: (headings[i + 1]?.endLineIndex ?? lines.length) - 1,
                breadcrumb: stack.map((item) => item.text),
            })
            stack.push({ level: heading.level, text: heading.text })
        })
    }

    for (const bound of bounds) {
        const runs = linesToRuns(lines.slice(bound.start, bound.end + 1))
        if (runs.length === 0) {
            // 只有标题没有正文的空 section 直接丢弃：否则会产出纯标题碎片污染索引，
            // 该标题仍会作为后续 chunk 的 scope 出现
            continue
        }
        sections.push({
            breadcrumb: bound.breadcrumb,
            heading: bound.heading?.text ?? null,
            level: bound.heading?.level ?? null,
            runs,
            pageNumbers: [],
        })
    }

    return sections
}

export function parseMarkdownFile(path: string): ParsedDocument {
    const fileName = path.split(/[\\/]/).pop() ?? path
    // 先归一化再解析：这样标题、正文、front-matter 里的 CJK 兼容字符会一起被还原
    const raw = normalizeText(readFileSync(path, 'utf8'))
    const front = extractFrontMatter(raw)
    const sections = markdownToSections(front.lines)
    const firstHeading = sections.find((section) => section.heading)?.heading

    const residuals = findResidualCompat(collectSectionText(sections))

    return {
        path,
        fileName,
        format: 'md',
        // front-matter 里若写了 title，优先用它
        title: front.values.title ?? firstHeading ?? fileName,
        sections,
        warnings: residuals.length > 0 ? [describeResidual(residuals)] : [],
        frontMatter: Object.keys(front.values).length > 0 ? front.values : undefined,
    }
}
