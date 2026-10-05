import type {
    Chunk,
    ChunkMetadata,
    ChunkOptions,
    DocumentMeta,
    ParsedDocument,
    Section,
} from '../types.js'
import { baseSlug, contentHash, makeChunkId } from './id.js'
import { splitTable } from './table.js'
import {
    buildEmbedText,
    chunkOptionsForMetadata,
    fitTextToChars,
    metadataBudget,
    type VectorMetadata,
} from './text.js'
import { buildLineStream, windowize } from './window.js'

/**
 * 分块主流程：Section 数组 → Chunk 数组。
 *
 * 每个 Section 按顺序产出一串「块」：
 *   - 文本流：走 zg 的滑窗算法（buildLineStream + windowize）
 *   - 表格：单独成块，不与正文混排
 *
 * 当一个 Section 的文本被切成多个窗口时，额外在最前面插一个「只有标题路径」的
 * outline 块，并让所有窗口共享同一个 group。这样纯标题也能被检索命中，
 * 且结果可以按 group 归并回同一个 section。
 *
 * 参数默认 3600/540：实测智谱 embedding-3 在纯中文最坏情况下 3600 字符仅 2090 tokens
 * （上限 3072），余量充足。见 spike 里的实测记录。
 */
export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
    maxChunkChars: 3600,
    chunkOverlapChars: 540,
}

interface Piece {
    kind: 'text' | 'outline' | 'table'
    content: string
}

/**
 * outline 块的文本：只用标题路径。
 *
 * 返回 null 表示这个 section **没有标题也没有标题路径**（例如用手动排版、没有用标题样式的
 * docx），此时不应该产出 outline 块 —— 它的内容会退化成「document section」这种占位符，
 * 变成一个短而无意义的 chunk，却因为泛化而排到很高的位置（实测在 dense Top-2 出现过）。
 */
function outlineText(section: Section): string | null {
    // 相比 zg 只取单个 heading，这里用完整标题路径，信息更足
    const path = [...section.breadcrumb, section.heading].filter(
        (part): part is string => typeof part === 'string' && part.trim().length > 0
    )
    return path.length > 0 ? path.join(' > ') : null
}

function groupIdFor(sectionIndex: number, source: string): string {
    // 用 baseSlug 而不是直接 sanitize：中文文件名会退化成 `---.docx`，
    // 不同文件撞成同一个 group id 后，按 group 折叠会误删结果
    return `grp-${String(sectionIndex).padStart(3, '0')}-${baseSlug(source, 24)}`
}

function collectSectionPieces(section: Section, options: ChunkOptions): Piece[] {
    const pieces: Piece[] = []
    let headingAttached = false

    for (const run of section.runs) {
        if (run.kind === 'table') {
            for (const content of splitTable(run.table, options.maxChunkChars)) {
                pieces.push({ kind: 'table', content })
            }
            continue
        }

        // 标题行只挂在第一个文本 Run 前面，否则每个 Run 都会重复一遍标题
        const stream = buildLineStream(
            headingAttached ? null : section.heading,
            section.level,
            run.units
        )
        headingAttached = true

        for (const content of windowize(stream, options)) {
            pieces.push({ kind: 'text', content })
        }
    }

    return pieces
}

export function documentToChunks(
    doc: ParsedDocument,
    meta: DocumentMeta,
    options: ChunkOptions = DEFAULT_CHUNK_OPTIONS
): Chunk[] {
    // 文档头 front-matter 优先于调用方传入的默认值：文档自己声明的 category/owner/version 更准确
    // 注意不要写成 Required<DocumentMeta>：Required 只去掉 `?`，不会去掉显式的 `| undefined`
    const resolved = {
        category: doc.frontMatter?.category ?? meta.category,
        owner: doc.frontMatter?.owner ?? meta.owner,
        sourceVersion: doc.frontMatter?.version ?? meta.sourceVersion,
        // 来源标识用相对路径（唯一），避免同名文件互相覆盖
        source: meta.source ?? doc.fileName,
    }

    const chunks: Chunk[] = []
    let chunkIndex = 0

    doc.sections.forEach((section, sectionIndex) => {
        const vectorMetadata: VectorMetadata = {
            heading: section.heading,
            headingLevel: section.level,
            scope: section.breadcrumb.length > 0 ? section.breadcrumb.join('::') : null,
        }

        // 元信息会拼进被向量化的文本，所以先把它占用的字符数从预算里扣掉
        const sectionOptions = chunkOptionsForMetadata(options, vectorMetadata)
        const pieces = collectSectionPieces(section, sectionOptions)

        const textPieceCount = pieces.filter((piece) => piece.kind === 'text').length
        const group = textPieceCount > 1 ? groupIdFor(sectionIndex, resolved.source) : null
        const outline = outlineText(section)

        // 只在「确实有标题路径」且「文本被切成多窗」时才补 outline 块
        if (textPieceCount > 1 && outline !== null) {
            pieces.unshift({
                kind: 'outline',
                content: fitTextToChars(outline, sectionOptions.maxChunkChars),
            })
        }

        for (const piece of pieces) {
            chunkIndex += 1
            const metadata: ChunkMetadata = {
                source: resolved.source,
                title: doc.title,
                format: doc.format,
                category: resolved.category,
                owner: resolved.owner,
                sourceVersion: resolved.sourceVersion,
                scope: vectorMetadata.scope,
                heading: vectorMetadata.heading,
                headingLevel: vectorMetadata.headingLevel,
                chunkIndex,
                group: piece.kind === 'table' ? null : group,
                contentHash: contentHash(piece.content),
                chunkLength: piece.content.length,
                kind: piece.kind,
                pageNumbers: section.pageNumbers,
            }

            chunks.push({
                id: makeChunkId(resolved.source, resolved.sourceVersion, chunkIndex, piece.content),
                content: piece.content,
                embedText: buildEmbedText(
                    vectorMetadata,
                    piece.content,
                    metadataBudget(options.maxChunkChars)
                ),
                metadata,
            })
        }
    })

    return chunks
}
