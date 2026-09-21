import { existsSync, rmSync } from 'node:fs'
import {
    ZVecCreateAndOpen,
    ZVecOpen,
    ZVecCollectionSchema,
    ZVecDataType,
    ZVecIndexType,
    ZVecMetricType,
} from '@zvec/zvec'
import type { ZVecCollection, ZVecDocInput } from '@zvec/zvec'
import type { Chunk } from '../types.js'

/**
 * Zvec 存储层：schema 定义、collection 打开/重建、文档映射与幂等写入。
 *
 * schema 设计依据全部来自实测（见 spike/schema-probe.ts）：
 *   - 可空字段只声明 `nullable: true` 还不够，**缺失时必须省略该字段**；
 *     显式传 null 会报 "Expected scalar field[x] to be a string"。
 *   - 页码用 ARRAY_INT64（实测 [1,2,3] 与 [] 都能存）。
 *   - 标量字段的 FTS 索引（jieba 分词）在 schema 里直接声明，中文检索实测有效。
 */

export const VECTOR_FIELD = 'embedding'

/** collection 名称，与目录名保持一致便于识别 */
export const COLLECTION_NAME = 'myrag'

export function buildSchema(dimensions: number): ZVecCollectionSchema {
    return new ZVecCollectionSchema({
        name: COLLECTION_NAME,
        vectors: [
            {
                name: VECTOR_FIELD,
                dataType: ZVecDataType.VECTOR_FP32,
                dimension: dimensions,
                // 默认度量是 IP，这里显式用 COSINE（智谱 embedding 已归一化，两者接近但语义更清晰）
                indexParams: { indexType: ZVecIndexType.FLAT, metricType: ZVecMetricType.COSINE },
            },
        ],
        fields: [
            {
                name: 'content',
                dataType: ZVecDataType.STRING,
                // 全文检索走 content（正文含自身标题行）；scope 作为独立标量字段供过滤
                indexParams: {
                    indexType: ZVecIndexType.FTS,
                    tokenizerName: 'jieba',
                    filters: ['lowercase'],
                },
            },
            { name: 'source', dataType: ZVecDataType.STRING },
            { name: 'title', dataType: ZVecDataType.STRING },
            { name: 'format', dataType: ZVecDataType.STRING },
            { name: 'category', dataType: ZVecDataType.STRING },
            { name: 'owner', dataType: ZVecDataType.STRING },
            { name: 'sourceVersion', dataType: ZVecDataType.STRING },
            { name: 'contentHash', dataType: ZVecDataType.STRING },
            { name: 'kind', dataType: ZVecDataType.STRING },
            { name: 'scope', dataType: ZVecDataType.STRING, nullable: true },
            { name: 'heading', dataType: ZVecDataType.STRING, nullable: true },
            { name: 'group', dataType: ZVecDataType.STRING, nullable: true },
            { name: 'headingLevel', dataType: ZVecDataType.INT64, nullable: true },
            { name: 'chunkIndex', dataType: ZVecDataType.INT64 },
            { name: 'chunkLength', dataType: ZVecDataType.INT64 },
            { name: 'pageNumbers', dataType: ZVecDataType.ARRAY_INT64 },
        ],
    })
}

export interface OpenResult {
    collection: ZVecCollection
    /** 本次是否新建了 collection */
    created: boolean
}

export interface OpenOptions {
    path: string
    dimensions: number
    /** 删掉现有 collection 重建。改维度必须走这一步 */
    rebuild?: boolean
}

/**
 * 把 Zvec 的锁冲突报错翻译成可操作的提示（读、写两侧共用）。
 *
 * 实测（2026-09-21）：一个进程持有句柄时，另一个进程无法写入同一个 collection，
 * 原始报错是 `Can't lock read-write collection: …\LOCK`，看不出该做什么。
 */
export function describeLockError(error: unknown, dbPath: string, role: 'read' | 'write'): Error {
    const message = error instanceof Error ? error.message : String(error)
    if (!/can't lock|lock read-write/i.test(message)) {
        return error instanceof Error ? error : new Error(message)
    }

    const hint =
        role === 'write'
            ? `collection 已被其他进程占用，无法写入：${dbPath}\n` +
              `Zvec 的写是单进程独占。占用者可能是持有句柄的服务进程（例如 AgentCode 里的 query()，\n` +
              `需先调用其 closeQuery() 释放），也可能是另一个正在运行的 ingest。请等它释放后重试。`
            : `collection 被其他进程占用：${dbPath}\n` +
              `占用者可能是正在运行的 ingest，或另一个持有句柄的进程。等待其释放后重试。`
    return new Error(hint)
}

export function openStore(options: OpenOptions): OpenResult {
    if (options.rebuild && existsSync(options.path)) {
        rmSync(options.path, { recursive: true, force: true })
    }

    const existing = existsSync(options.path)
    let collection: ZVecCollection
    try {
        collection = existing
            ? ZVecOpen(options.path)
            : ZVecCreateAndOpen(options.path, buildSchema(options.dimensions))
    } catch (error) {
        throw describeLockError(error, options.path, 'write')
    }

    // 维度不一致时继续写入会得到难以定位的报错，这里提前拦下
    const vectorField = collection.schema.vectors().find((vector) => vector.name === VECTOR_FIELD)
    if (!vectorField) {
        throw new Error(`collection 里找不到向量字段 ${VECTOR_FIELD}，目录可能不是 MyRAG 创建的：${options.path}`)
    }
    if (vectorField.dimension !== options.dimensions) {
        throw new Error(
            `collection 现有维度 ${vectorField.dimension}，代码配置 ${options.dimensions}。` +
                `schema 在创建时固化，改维度必须重建：加 --rebuild（会清空现有数据后重新灌入）`
        )
    }

    return { collection, created: !existing }
}

/**
 * 只读打开已存在的 collection。
 *
 * 与 openStore 的区别：**不存在就报错，绝不顺手新建**。
 * 查询场景下如果 collection 不存在，说明还没灌库，静默新建一个空 collection
 * 只会让人以为「检索没结果」而不是「没有数据」。
 */
export function openStoreForRead(path: string): ZVecCollection {
    if (!existsSync(path)) {
        throw new Error(`collection 不存在：${path}\n请先运行 npm run ingest 灌库。`)
    }
    try {
        return ZVecOpen(path)
    } catch (error) {
        throw describeLockError(error, path, 'read')
    }
}

/**
 * filter 里的字符串字面量转义。规则来自 zg 的实现（dist/engine/storage/zvec.js）：
 * 用单引号包裹，反斜杠和单引号各自转义。文件名里可能出现这两种字符，不能直接拼接。
 */
export function quoteFilter(value: string): string {
    return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

/** Chunk → Zvec 文档。可空字段缺失时省略，绝不传 null */
export function chunkToDoc(chunk: Chunk, vector: number[]): ZVecDocInput {
    const metadata = chunk.metadata
    const fields: Record<string, unknown> = {
        content: chunk.content,
        source: metadata.source,
        title: metadata.title,
        format: metadata.format,
        category: metadata.category,
        owner: metadata.owner,
        sourceVersion: metadata.sourceVersion,
        contentHash: metadata.contentHash,
        kind: metadata.kind,
        chunkIndex: metadata.chunkIndex,
        chunkLength: metadata.chunkLength,
        pageNumbers: metadata.pageNumbers,
    }

    if (metadata.scope !== null) {
        fields.scope = metadata.scope
    }
    if (metadata.heading !== null) {
        fields.heading = metadata.heading
    }
    if (metadata.group !== null) {
        fields.group = metadata.group
    }
    if (metadata.headingLevel !== null) {
        fields.headingLevel = metadata.headingLevel
    }

    return { id: chunk.id, vectors: { [VECTOR_FIELD]: vector }, fields }
}

/** 删除某个来源文件的全部 chunk。用于「重灌前清旧」，避免文件变短后留下过期 chunk */
export function deleteBySource(collection: ZVecCollection, source: string): number {
    const before = collection.stats.docCount
    collection.deleteByFilterSync(`source = ${quoteFilter(source)}`)
    return before - collection.stats.docCount
}

export interface UpsertResult {
    ok: number
    failed: Array<{ id: string; message: string }>
}

/** 写入（存在则更新）。逐个检查 status，失败的收集起来而不是默默放过 */
export function upsertDocs(collection: ZVecCollection, docs: ZVecDocInput[]): UpsertResult {
    if (docs.length === 0) {
        return { ok: 0, failed: [] }
    }

    const statuses = collection.upsertSync(docs)
    const list = Array.isArray(statuses) ? statuses : [statuses]

    const result: UpsertResult = { ok: 0, failed: [] }
    list.forEach((status, index) => {
        if (status.ok) {
            result.ok++
            return
        }
        result.failed.push({
            id: docs[index]?.id ?? `#${index}`,
            message: `${status.code} ${status.message}`.trim(),
        })
    })
    return result
}
