import type { TableData } from '../types.js'
import { splitLongLine } from './window.js'

/**
 * 表格处理。
 *
 * 表格必须单独成块，不能与正文混排，也不能在行与行之间被普通滑窗切开：
 * 切碎的表头/数据行会同时破坏语义和可读性。所以分块主流程把表格当作原子 Run，
 * 只有它自身超过 maxChunkChars 时才按行切分，并且每块都重复表头。
 */

/** 把表格渲染成 markdown 表格的行，表头与数据行分开返回（便于按行切分时重复表头） */
export function tableLines(table: TableData): { header: string[]; body: string[] } {
    const cells = normalizeCells(table)
    if (cells.length === 0) {
        return { header: [], body: [] }
    }

    const hasHeader = table.header.length > 0
    // 上面已排除空数组，cells 的第一行必然存在
    const firstRow = cells[0] ?? []
    const header: string[] = []
    if (hasHeader) {
        header.push(`| ${firstRow.join(' | ')} |`)
        header.push(`| ${firstRow.map(() => '---').join(' | ')} |`)
    }

    return {
        header,
        body: cells.slice(hasHeader ? 1 : 0).map((row) => `| ${row.join(' | ')} |`),
    }
}

export function renderTable(table: TableData): string {
    const { header, body } = tableLines(table)
    return [...header, ...body].join('\n')
}

/** 表格超过 maxChunkChars 时按行切分，每块重复表头 */
export function splitTable(table: TableData, maxChunkChars: number): string[] {
    const { header, body } = tableLines(table)
    if (body.length === 0) {
        const single = header.join('\n')
        return single ? [single] : []
    }

    const overhead = header.length > 0 ? header.join('\n').length + 1 : 0
    const chunks: string[] = []
    let current: string[] = []
    let used = overhead

    const flush = () => {
        if (current.length === 0) {
            return
        }
        chunks.push([...header, ...current].join('\n'))
        current = []
        used = overhead
    }

    for (const line of body) {
        if (line.length + 1 > maxChunkChars) {
            flush()
            chunks.push([...header, ...splitLongLine(line, maxChunkChars)].join('\n'))
            continue
        }
        if (used + line.length + 1 > maxChunkChars && current.length > 0) {
            flush()
        }
        current.push(line)
        used += line.length + 1
    }
    flush()

    return chunks.length > 0 ? chunks : [header.join('\n')].filter(Boolean)
}

/** 补齐各行列数、转义分隔符、把单元格内的换行压成空格 */
function normalizeCells(table: TableData): string[][] {
    const columnCount = Math.max(1, table.header.length, ...table.rows.map((row) => row.length))

    const fill = (row: string[]) => {
        const cells = row.map((cell) =>
            String(cell ?? '')
                .replace(/\|/g, '\\|')
                .replace(/\s*\n\s*/g, ' ')
                .trim()
        )
        while (cells.length < columnCount) {
            cells.push('')
        }
        return cells
    }

    const out: string[][] = []
    if (table.header.length > 0) {
        out.push(fill(table.header))
    }
    for (const row of table.rows) {
        out.push(fill(row))
    }
    return out
}
