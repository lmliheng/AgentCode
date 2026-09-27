import { OfficeParser, type SupportedFileType } from 'officeparser'
import type { ParsedDocument, Run, Section, TableData, TextUnit } from '../types.js'
import { collectSectionText, describeResidual, findResidualCompat, normalizeText } from './normalize.js'

/**
 * officeparser AST → Section 数组。
 *
 * 设计要点：
 *   1. 标题按层级维护一个栈，得到 breadcrumb（标题路径）—— 这是提升检索区分度的核心信息
 *   2. 表格单独成为一个 Run，不进入正文行流，保证它不会被切碎或与正文混排
 *   3. 原文没有标题结构时（例如用手动居中加粗排版、没有用 Word 标题样式的文档），
 *      全部内容会落进同一个 breadcrumb 为空的 Section，随后由滑窗按 maxChunkChars 聚合。
 *      这一条正好补上了 officeparser 自带 chunks 的缺口：它会把这类文档切成逐段落碎片。
 *   4. 只有标题没有正文的空 Section 直接丢弃 —— 否则会产出 3~7 字符的纯标题碎片污染索引，
 *      而该标题仍会作为 scope 出现在后续 chunk 的元信息里，信息不会丢。
 */

/**
 * 只截取节点自身的文本；text 为空时回退到拼接子节点。
 *
 * 归一化放在这里而不是各个调用点：这样标题、表格单元格、列表项都会自动覆盖，不会漏分支。
 * 子节点文本已经归一化过，外层的再次归一化是 no-op（HINT 检测会直接短路）。
 */
function nodeText(node: any): string {
    const direct = typeof node?.text === 'string' ? node.text : ''
    if (direct.trim()) {
        return normalizeText(direct)
    }
    const children = Array.isArray(node?.children) ? node.children : []
    return normalizeText(
        children
            .map((child: any) => nodeText(child))
            .filter((text: string) => text.trim())
            .join(' ')
    )
}

/** list 节点是「一个列表项」，不是整个列表，所以要自己补上符号 */
function listItemText(node: any): string {
    const meta = node?.metadata ?? {}
    const indent = '  '.repeat(Math.max(0, Number(meta.indentation) || 0))
    const marker = meta.listType === 'ordered' ? `${(Number(meta.itemIndex) || 0) + 1}. ` : '- '
    return `${indent}${marker}${nodeText(node).trim()}`
}

/**
 * 把表格节点转成二维数组。
 * colSpan 需要展开成占位空单元格，否则合并单元格会让后续列整体错位。
 * 第一行按约定视为表头（markdown 表格的习惯，也和实际情况一致）。
 */
function tableFromNode(node: any): TableData | null {
    const rows = (Array.isArray(node?.children) ? node.children : []).filter(
        (row: any) => String(row?.type) === 'row'
    )
    if (rows.length === 0) {
        return null
    }

    const grid = rows.map((row: any) =>
        (Array.isArray(row?.children) ? row.children : [])
            .filter((cell: any) => String(cell?.type) === 'cell')
            .flatMap((cell: any) => {
                const span = Math.max(1, Number(cell?.metadata?.colSpan) || 1)
                const text = nodeText(cell)
                return span > 1 ? [text, ...new Array(span - 1).fill('')] : [text]
            })
    )

    return { header: grid[0] ?? [], rows: grid.slice(1) }
}

interface WalkContext {
    sections: Section[]
    current: Section
    stack: Array<{ level: number; text: string }>
    buffer: TextUnit[]
    currentPage: number | null
}

function emptySection(breadcrumb: string[], heading: string | null, level: number | null): Section {
    return { breadcrumb, heading, level, runs: [], pageNumbers: [] }
}

function flushBuffer(ctx: WalkContext) {
    if (ctx.buffer.length === 0) {
        return
    }
    ctx.current.runs.push({ kind: 'text', units: ctx.buffer })
    ctx.buffer = []
}

function closeSection(ctx: WalkContext) {
    flushBuffer(ctx)
    if (ctx.current.runs.length > 0) {
        ctx.sections.push(ctx.current)
    }
}

function notePage(ctx: WalkContext) {
    if (ctx.currentPage !== null && !ctx.current.pageNumbers.includes(ctx.currentPage)) {
        ctx.current.pageNumbers.push(ctx.currentPage)
    }
}

function walkNodes(nodes: any[], ctx: WalkContext) {
    for (const node of nodes ?? []) {
        const type = String(node?.type ?? '')
        const text = nodeText(node)

        switch (type) {
            case 'heading': {
                const level = Math.max(1, Number(node?.metadata?.level ?? node?.level) || 1)
                flushBuffer(ctx)
                // 同级或更深的标题都要弹出，剩下的栈即父级路径
                let parent = ctx.stack[ctx.stack.length - 1]
                while (parent && parent.level >= level) {
                    ctx.stack.pop()
                    parent = ctx.stack[ctx.stack.length - 1]
                }
                closeSection(ctx)
                ctx.current = emptySection(
                    ctx.stack.map((item) => item.text),
                    text.trim() || null,
                    level
                )
                ctx.stack.push({ level, text: text.trim() })
                notePage(ctx)
                break
            }

            case 'table': {
                const table = tableFromNode(node)
                if (table && (table.header.length > 0 || table.rows.length > 0)) {
                    flushBuffer(ctx)
                    notePage(ctx)
                    ctx.current.runs.push({ kind: 'table', table })
                }
                break
            }

            case 'code': {
                if (text.trim()) {
                    notePage(ctx)
                    ctx.buffer.push({ kind: 'code', text, language: node?.metadata?.language })
                }
                break
            }

            case 'list': {
                if (text.trim()) {
                    notePage(ctx)
                    ctx.buffer.push({ kind: 'list', text: listItemText(node) })
                }
                break
            }

            case 'paragraph':
            case 'admonition':
            case 'definitionList': {
                if (text.trim()) {
                    notePage(ctx)
                    ctx.buffer.push({ kind: 'paragraph', text })
                }
                break
            }

            default: {
                // page / slide / sheet 等容器：递归处理，不用它们拼接好的 text（否则内容会重复一遍）
                const children = Array.isArray(node?.children) ? node.children : []
                if (children.length > 0) {
                    const pageNumber = Number(node?.metadata?.pageNumber)
                    const previousPage = ctx.currentPage
                    if (Number.isFinite(pageNumber)) {
                        ctx.currentPage = pageNumber
                    }
                    walkNodes(children, ctx)
                    ctx.currentPage = previousPage
                } else if (text.trim()) {
                    notePage(ctx)
                    ctx.buffer.push({ kind: 'paragraph', text })
                }
            }
        }
    }
}

export function astToSections(ast: any): Section[] {
    const ctx: WalkContext = {
        sections: [],
        current: emptySection([], null, null),
        stack: [],
        buffer: [],
        currentPage: null,
    }

    walkNodes(ast?.content ?? [], ctx)
    closeSection(ctx)

    return ctx.sections
}

/** 从文档里找第一个标题作为标题，找不到就用元信息或文件名 */
function guessTitle(sections: Section[], ast: any, fileName: string): string {
    for (const section of sections) {
        if (section.heading) {
            return section.heading
        }
    }
    const metaTitle = ast?.metadata?.title
    if (typeof metaTitle === 'string' && metaTitle.trim() && metaTitle !== 'about:blank') {
        return normalizeText(metaTitle.trim())
    }
    return fileName
}

export async function parseDocument(
    path: string,
    options: { fileType?: SupportedFileType } = {}
): Promise<ParsedDocument> {
    const ast: any = await OfficeParser.parseOffice(path, options.fileType ? { fileType: options.fileType } : {})
    const fileName = path.split(/[\\/]/).pop() ?? path
    const sections = astToSections(ast)

    const warnings = (ast?.warnings ?? []).map((warning: any) => String(warning?.message ?? warning))
    const residuals = findResidualCompat(collectSectionText(sections))
    if (residuals.length > 0) {
        warnings.push(describeResidual(residuals))
    }

    return {
        path,
        fileName,
        format: String(ast?.type ?? 'unknown'),
        title: guessTitle(sections, ast, fileName),
        sections,
        warnings,
    }
}
