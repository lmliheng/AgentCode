import { createHash } from 'node:crypto'

/**
 * Zvec 的 doc id 约束（实测，见 spike/id-probe.ts）：
 *   - 只允许 ASCII 字母数字和 - _ . # @ + = % $
 *   - 最大 64 字符（65 即报 "contains invalid characters"，且报错信息会误导成字符集问题）
 *
 * 这里把来源名截断到 32 字符，用 '-' 而不是原来的 ':' 作分隔符。
 * 最坏长度 = 32 + 1 + 2 + 1 + 3 + 1 + 12 = 52，留有余量。
 */
export const MAX_ID_LENGTH = 64

const ID_SAFE = /[^A-Za-z0-9._-]/g
const BASE_MAX = 32

/** 取内容的 12 位 sha256，用于判断 chunk 是否变化 */
export function contentHash(text: string): string {
    return createHash('sha256').update(text).digest('hex').slice(0, 12)
}

/**
 * 生成 ASCII 安全的名字片段，用于 chunk id 与 group id。
 *
 * 中文文件名（如「报告.docx」）被字符集过滤后只剩横杠，会退化成一串无意义的 `-`，
 * 而且不同文件可能撞成同一个片段（「报告.docx」与「简历.docx」→ 都是 `---.docx`）。
 * 这种情况下改用文件名的哈希：仍然确定性、稳定，且不同文件不会撞。
 * 展示用的原始文件名保留在 metadata.source 里。
 */
export function baseSlug(source: string, maxLength: number = BASE_MAX): string {
    const raw = source.replace(/\.[^.]+$/, '')
    const base = raw.replace(ID_SAFE, '-').slice(0, maxLength)
    if (/[A-Za-z0-9]/.test(base)) {
        return base
    }
    return createHash('sha256').update(source).digest('hex').slice(0, 8)
}

export function makeChunkId(
    source: string,
    version: string,
    index: number,
    content: string
): string {
    const base = baseSlug(source, BASE_MAX)
    const id = `${base}-${version.replace(ID_SAFE, '-')}-${String(index).padStart(3, '0')}-${contentHash(content)}`

    if (id.length > MAX_ID_LENGTH) {
        throw new Error(`生成的 chunk id 超过 ${MAX_ID_LENGTH} 字符：${id.length} —— ${id}`)
    }
    return id
}
