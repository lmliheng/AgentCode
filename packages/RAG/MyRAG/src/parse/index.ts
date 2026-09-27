import type { ParsedDocument } from '../types.js'
import { parseDocument } from './ast.js'
import { parseMarkdownFile } from './markdown.js'

/**
 * 统一解析入口：按扩展名分发。
 *
 *   md / mdx / markdown  → 自研解析（纯文本可精确处理，officeparser 会破坏列表内的代码块）
 *   其余格式             → officeparser（docx / pdf / xlsx / pptx / odt / rtf / csv / epub / html）
 *
 * 两条路径产出同一个 ParsedDocument 契约，下游的分块与存储完全共用。
 */
const MARKDOWN_EXTENSIONS = /\.(md|mdx|markdown)$/i

export async function parseFile(path: string): Promise<ParsedDocument> {
    return MARKDOWN_EXTENSIONS.test(path) ? parseMarkdownFile(path) : parseDocument(path)
}
