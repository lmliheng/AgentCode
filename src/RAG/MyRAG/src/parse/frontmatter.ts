/**
 * 文档头元信息（front-matter）提取。
 *
 * 支持两种写法：
 *
 *   1) `---` 包裹的 YAML 块（块内任意键，因为是显式分隔的，安全）
 *      ---
 *      category: agent mcp
 *      owner: liheng
 *      ---
 *
 *   2) 裸行块（沿用旧实现 `rag-chunk` 的约定，但**只认已知键**）
 *      category: agent mcp
 *      owner: liheng
 *      version: 2026-08-20
 *
 * 裸行块之所以限制键名，是因为没有分隔符时「key: value」这种行在正文里很常见
 * （例如 `核心原理：将文本编码为向量`），不限制会把正文误当元信息删掉。
 * 旧实现用 `lines.find()` 在全文里搜，存在同样的风险，这里收紧为
 * 「开头附近连续出现、且键名在已知集合内」。
 */

/** 裸行写法允许的键名 */
const BARE_KEYS = new Set(['category', 'owner', 'version'])

/** 键名限定 ASCII，避免把正文里「中文：内容」这种行误判 */
const SCALAR_LINE = /^([A-Za-z0-9_-]+)\s*:\s*(.+)$/

export interface FrontMatterResult {
    values: Record<string, string>
    /** 剔除 front-matter 之后的正文行 */
    lines: string[]
    /** 被剔除的行号区间（含两端），没有剔除时为 null */
    removed: { start: number; end: number } | null
}

function parseScalarLine(line: string): { key: string; value: string } | null {
    const match = line.match(SCALAR_LINE)
    if (!match) {
        return null
    }
    const [, key, rawValue] = match
    // 正则里两个捕获组都是必需的，命中时必然存在；这里只是收窄类型
    if (key === undefined || rawValue === undefined) {
        return null
    }
    const value = rawValue.trim().replace(/^["']|["']$/g, '')
    // 值为空或像是嵌套结构（- 开头）的，不当标量处理
    if (value === '' || value.startsWith('-') || value.startsWith('{') || value.startsWith('[')) {
        return null
    }
    return { key, value }
}

/** 从 startIndex 起找 `---` 或 `...` 结束分隔符，返回其行号；找不到返回 -1 */
function findClosingDelimiter(lines: string[], startIndex: number): number {
    for (let index = startIndex; index < lines.length; index++) {
        const trimmed = (lines[index] ?? '').trim()
        if (trimmed === '---' || trimmed === '...') {
            return index
        }
    }
    return -1
}

export function extractFrontMatter(raw: string): FrontMatterResult {
    // 去掉 BOM，否则首行的 `#` 或 `---` 会匹配不上
    const lines = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n')
    const values: Record<string, string> = {}

    // ---------- 1) --- 包裹的 YAML 块 ----------
    let cursor = 0
    while (cursor < lines.length && (lines[cursor] ?? '').trim() === '') {
        cursor++
    }
    if (lines[cursor]?.trim() === '---') {
        const end = findClosingDelimiter(lines, cursor + 1)
        if (end > cursor) {
            for (let index = cursor + 1; index < end; index++) {
                const parsed = parseScalarLine(lines[index] ?? '')
                if (parsed) {
                    values[parsed.key.toLowerCase()] = parsed.value
                }
            }
            if (Object.keys(values).length > 0) {
                return {
                    values,
                    lines: [...lines.slice(0, cursor), ...lines.slice(end + 1)],
                    removed: { start: cursor, end },
                }
            }
        }
    }

    // ---------- 2) 裸行块 ----------
    cursor = 0
    while (cursor < lines.length) {
        const trimmed = (lines[cursor] ?? '').trim()
        // 允许开头有空行和标题行
        if (trimmed === '' || trimmed.startsWith('#')) {
            cursor++
            continue
        }

        const first = parseScalarLine(lines[cursor] ?? '')
        if (!first || !BARE_KEYS.has(first.key.toLowerCase())) {
            break
        }

        const start = cursor
        while (cursor < lines.length) {
            const parsed = parseScalarLine(lines[cursor] ?? '')
            if (!parsed || !BARE_KEYS.has(parsed.key.toLowerCase())) {
                break
            }
            values[parsed.key.toLowerCase()] = parsed.value
            cursor++
        }

        return {
            values,
            lines: [...lines.slice(0, start), ...lines.slice(cursor)],
            removed: { start, end: cursor - 1 },
        }
    }

    return { values, lines, removed: null }
}
