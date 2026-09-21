/**
 * MyRAG 的核心数据契约。
 *
 * 层次关系：文件 → ParsedDocument（Section 数组）→ Chunk 数组
 *   Section = 一个标题作用域内的内容（带 breadcrumb 标题路径）
 *   Run     = Section 内的一段内容，要么是文本流，要么是一张表（表格必须单独成块，不与正文混排）
 */

/** 文本单元的来源类型，用于分块时的切点打分 */
export type UnitKind = 'paragraph' | 'list' | 'code' | 'admonition' | 'definitionList'

export interface TextUnit {
    kind: UnitKind
    text: string
    /** code 单元的语言标记，未知时为 undefined */
    language?: string | undefined
}

export interface TableData {
    /** 表头单元格。为空数组表示这张表没有表头 */
    header: string[]
    /** 数据行 */
    rows: string[][]
}

/** Section 内的一段内容。表格单独成为一个 Run，保证它不会被切碎或与正文混排 */
export type Run =
    | { kind: 'text'; units: TextUnit[] }
    | { kind: 'table'; table: TableData }

export interface Section {
    /** 标题路径，例如 ['抽象语法树', 'Node 节点']。原文没有标题结构时为空数组 */
    breadcrumb: string[]
    /** 本 section 自身的标题文本 */
    heading: string | null
    /** 本 section 标题的层级 */
    level: number | null
    runs: Run[]
    /** 涉及的页码（仅 PDF 等带页码的格式） */
    pageNumbers: number[]
}

export interface ChunkMetadata {
    source: string
    title: string
    format: string
    /** 业务分类。来自文档头 front-matter，没有则取调用方传入的默认值 */
    category: string
    owner: string
    sourceVersion: string
    /** breadcrumb 用 '::' 连接，作为作用域标识 */
    scope: string | null
    heading: string | null
    headingLevel: number | null
    chunkIndex: number
    /** 同一 section 被切成多窗时共享此 id，便于检索结果归并 */
    group: string | null
    contentHash: string
    chunkLength: number
    /** outline = 只有标题路径的辅助块，用于让纯标题也能被检索命中 */
    kind: 'text' | 'outline' | 'table'
    pageNumbers: number[]
}

export interface Chunk {
    /** Zvec doc id，受 64 字符 / 字符集约束（见 chunk/id.ts） */
    id: string
    /** 面向展示与引用的正文 */
    content: string
    /** 面向 embedding 的文本 = 元信息前缀 + content */
    embedText: string
    metadata: ChunkMetadata
}

export interface ChunkOptions {
    /** 单个 chunk 的最大字符数 */
    maxChunkChars: number
    /** 相邻窗口的重叠字符数 */
    chunkOverlapChars: number
}

export interface ParsedDocument {
    path: string
    fileName: string
    format: string
    title: string
    sections: Section[]
    warnings: string[]
    /** 文档头提取到的元信息（category / owner / version 等），会覆盖灌库时的默认值 */
    frontMatter?: Record<string, string> | undefined
}

/** 灌库时补进来的业务元信息 */
export interface DocumentMeta {
    category: string
    owner: string
    sourceVersion: string
    /**
     * 来源标识，用于写入 metadata.source 并生成 chunk id。
     *
     * 必须传「相对入库根目录的路径」（如 tips/curry.md），**不要传 basename**：
     * 语料里存在同名文件（compiler/overview.md 与 typings/overview.md），
     * 用 basename 会让后灌的文件把先灌的同名文件的 chunk 删掉。
     * 不传时回退到文件名，仅适用于单层目录的简单场景。
     */
    source?: string | undefined
}
