import { resolve } from 'node:path'
import type { ZVecCollection } from '@zvec/zvec'
import { openStoreForRead } from '../store/zvec.js'
import { retrieve, type QueryMode, type QueryResult, type RerankType } from './index.js'

/**
 * 对外 API：一次调用完成「打开 collection → 向量化提问 → 检索」。
 * 调用方不需要知道 Zvec、store 或 embedding 的存在。
 *
 * ## 句柄缓存与锁（实测约束，很重要）
 *
 * 实测（2026-09-21）：
 *   - `ZVecOpen` 打开句柄平均 **383 ms**；复用已打开的句柄读 stats 只要 **0.023 ms**
 *   - 一个进程持有句柄时，**另一个进程无法写入同一个 collection**，报
 *     `Can't lock read-write collection: …\LOCK`（同进程内可重复打开，锁是跨进程的）
 *
 * 所以默认 `keepOpen: true`：首次调用打开并保留，之后几乎零开销。
 * **代价是持有期间 `npm run ingest` 会被挡在门外**，灌库前必须先 `closeQuery()`。
 * 若调用方无法确定何时灌库，用 `keepOpen: false` 换取安全（每次多花约 0.4 秒）。
 */

export interface ClientOptions {
    /** collection 目录，默认 `./zvec-data/myrag`（相对进程当前工作目录） */
    db?: string
    /** 返回条数，默认 5 */
    topk?: number
    /** 检索模式，默认 dense */
    mode?: QueryMode
    /** 仅 hybrid 生效的融合方式 */
    rerank?: RerankType
    /** 仅 hybrid + weighted 生效的权重，顺序 [dense, fts] */
    weights?: [number, number] | undefined
    /** Zvec filter 表达式，字符串用单引号，如 `category = 'typescript-doc'` */
    filter?: string | undefined
    /** 是否按 group 折叠，默认 true */
    collapseGroups?: boolean | undefined
    /**
     * 是否复用常驻句柄，默认 true。
     * false 时每次调用打开再关闭：安全（不阻塞灌库）但每次多约 0.4 秒。
     */
    keepOpen?: boolean
}

interface CachedHandle {
    path: string
    collection: ZVecCollection
}

let cached: CachedHandle | null = null

function acquireHandle(dbPath: string, keepOpen: boolean): ZVecCollection {
    if (cached && cached.path === dbPath) {
        return cached.collection
    }
    // 换库时先放掉旧句柄，避免同时持有两个造成互相阻塞
    if (cached) {
        closeQuery()
    }

    // openStoreForRead 已把锁冲突翻译成可操作的提示
    const collection = openStoreForRead(dbPath)

    if (keepOpen) {
        cached = { path: dbPath, collection }
    }
    return collection
}

/**
 * 释放缓存的句柄。
 *
 * **灌库（`npm run ingest`）之前必须调用**，否则 ingest 会因锁冲突失败。
 * 幂等：没有缓存时调用是安全的空操作。
 */
export function closeQuery(): void {
    if (!cached) {
        return
    }
    const handle = cached
    cached = null
    handle.collection.closeSync()
}

/** 当前缓存的句柄状态，便于诊断「为什么查询变慢 / 为什么灌库被锁」 */
export function queryHandleState(): { open: boolean; path: string | null } {
    return { open: cached !== null, path: cached?.path ?? null }
}

export async function query(question: string, options: ClientOptions = {}): Promise<QueryResult> {
    const dbPath = resolve(options.db ?? './zvec-data/myrag')
    const keepOpen = options.keepOpen ?? true
    const collection = acquireHandle(dbPath, keepOpen)

    try {
        return await retrieve(collection, {
            question,
            topk: options.topk,
            mode: options.mode,
            rerank: options.rerank,
            weights: options.weights,
            filter: options.filter,
            collapseGroups: options.collapseGroups,
        })
    } finally {
        if (!keepOpen) {
            collection.closeSync()
        }
    }
}
