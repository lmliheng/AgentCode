/**
 * MyRAG 对外入口。
 *
 * 交付形态是「模块优先」：调用方**进程内 import**，没有 HTTP 层。
 *
 * ```ts
 * import { query, closeQuery } from './src/index.js'
 *
 * const result = await query('TypeScript 里怎么把 union 转成 intersection', { topk: 5 })
 * for (const hit of result.hits) {
 *     console.log(hit.score, hit.source, hit.scope, hit.content.slice(0, 80))
 * }
 *
 * // 要灌库时先释放句柄，否则 ingest 会被锁挡住
 * closeQuery()
 * ```
 *
 * 注意：
 *   - **灌库仍然是独立 CLI**（`npm run ingest`），不作为函数导出。原因是 Zvec 的写是单进程独占，
 *     进程内同时持有读句柄会让灌库失败；调用方在灌库前需先 `closeQuery()`。
 *   - 本入口是 TypeScript 源码，消费方需要能直接跑 TS（本项目全程用 `tsx`）。
 *     若要作为普通 npm 包发布，需要先加一步构建产出 dist。
 */

export { query, closeQuery, queryHandleState, type ClientOptions } from './query/client.js'

export type {
    QueryHit,
    QueryMode,
    QueryResult,
    RerankType,
    QueryOptions,
} from './query/index.js'

/** 需要自己拼检索逻辑时可以直接用这些底层能力 */
export { retrieve, collapseGroups, dimensionOf, DEFAULT_QUERY_TOPK } from './query/index.js'
export { parseFile } from './parse/index.js'
export { documentToChunks, DEFAULT_CHUNK_OPTIONS } from './chunk/index.js'
export { normalizeText } from './parse/normalize.js'
export type { Chunk, ChunkMetadata, ChunkOptions, DocumentMeta, ParsedDocument, Section } from './types.js'
