import type { ChunkOptions } from '../types.js'

/**
 * 元信息进向量文本的处理（对应 zg 的 vector-content.ts）。
 *
 * 关键点：标题路径不是只放在 metadata 字段里，而是**拼进被向量化的文本**。
 * 这样「处于某个标题下」这件事本身就参与语义匹配，是提升召回区分度的重要机制。
 * 代价是它会占用 chunk 的字符预算，所以必须预先扣除（见 chunkOptionsForMetadata）。
 */

/** 元信息最多占 chunk 字符预算的 25% */
export const METADATA_BUDGET_RATIO = 0.25

export interface VectorMetadata {
    heading: string | null
    headingLevel: number | null
    scope: string | null
}

/** 把元信息渲染成前缀文本；maxChars 给定时会截断到该长度 */
export function vectorMetadataText(metadata: VectorMetadata, maxChars?: number): string {
    const lines = [
        metadata.heading ? `heading: ${metadata.heading}` : null,
        typeof metadata.headingLevel === 'number' ? `heading_level: ${metadata.headingLevel}` : null,
        metadata.scope ? `scope: ${metadata.scope}` : null,
    ].filter((line): line is string => line !== null && line.trim().length > 0)

    const text = lines.join('\n')
    return maxChars === undefined ? text : fitTextToChars(text, maxChars)
}

export function metadataBudget(maxChars: number): number {
    return Math.max(0, Math.floor(maxChars * METADATA_BUDGET_RATIO))
}

/** 按字符数截断，保留省略号；不会把代理对切成半个字符 */
export function fitTextToChars(value: string, maxChars: number): string {
    if (value.length <= maxChars) {
        return value
    }
    if (maxChars <= 3) {
        return '.'.repeat(Math.max(0, maxChars))
    }
    let end = maxChars - 3
    if (
        end > 0 &&
        end < value.length &&
        isHighSurrogate(value.charCodeAt(end - 1)) &&
        isLowSurrogate(value.charCodeAt(end))
    ) {
        end -= 1
    }
    return `${value.slice(0, end).trimEnd()}...`
}

/**
 * 从 maxChunkChars 里预先扣掉元信息前缀占用的字符数。
 *
 * 必须先扣再切窗，否则「content 刚好等于 3600」的 chunk 拼上前缀就会超出 embedding 的预算。
 */
export function chunkOptionsForMetadata(
    options: ChunkOptions,
    metadata: VectorMetadata
): ChunkOptions {
    const metadataText = vectorMetadataText(metadata, metadataBudget(options.maxChunkChars))
    const separatorChars = metadataText.length > 0 ? 1 : 0
    const maxChunkChars = Math.max(1, options.maxChunkChars - metadataText.length - separatorChars)
    const chunkOverlapChars = Math.min(options.chunkOverlapChars, Math.max(0, maxChunkChars - 1))

    return { maxChunkChars, chunkOverlapChars }
}

export function buildEmbedText(metadata: VectorMetadata, content: string, maxChars?: number): string {
    const metadataText = vectorMetadataText(metadata, maxChars)
    return metadataText.length > 0 ? `${metadataText}\n${content}` : content
}

function isHighSurrogate(value: number): boolean {
    return value >= 0xd800 && value <= 0xdbff
}

function isLowSurrogate(value: number): boolean {
    return value >= 0xdc00 && value <= 0xdfff
}
