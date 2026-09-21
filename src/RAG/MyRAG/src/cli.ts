/**
 * MyRAG 命令行入口。
 *
 * 用法：
 *   tsx src/cli.ts chunk  <目录或文件> [选项]    只解析 + 分块，不写任何东西
 *   tsx src/cli.ts ingest <目录或文件> [选项]    解析 → 分块 → embedding → 写入 Zvec
 *   tsx src/cli.ts query  <问题> [选项]          检索已入库的 chunk
 *   tsx src/cli.ts eval   <标注集.json> [选项]   对多个检索配置做 hit@k / MRR 评测
 *
 * 通用选项：
 *   --exclude <路径段>    排除路径中名为该值的目录或文件，可重复（例如 --exclude jsx 只排除 jsx 目录，
 *                         不会误伤 faqs/jsx-and-react.md）
 *   --category <值>       写入 chunk 元信息的业务字段，默认 unknown（文档头有 category: 时以文档为准）
 *   --owner <值>          同上，默认 unknown
 *   --version <值>        来源版本，参与 chunk id 生成，默认 v1
 *   --limit <n>           只处理前 n 个文件，便于快速试跑
 *   --quiet               只打印汇总，不逐文件打印
 *   --db <路径>           collection 目录，默认 ./zvec-data/myrag
 *
 * chunk 专用：
 *   --export <路径>       把分块明细写成 markdown，供人工审核
 *
 * ingest 专用：
 *   --dim <n>             向量维度，默认 1024。schema 创建时固化，改它必须配 --rebuild
 *   --batch <n>           embedding 单次请求条数，默认 64（官方上限）
 *   --rebuild             删除现有 collection 后重建（会清空已有数据）
 *
 * query 专用：
 *   --topk <n>            返回条数，默认 5
 *   --mode <值>           dense（默认）/ fts / hybrid（dense + FTS 融合）
 *                         默认值是 dense —— 47 条标注集实测 dense 95.7% / MRR 0.866，
 *                         优于 fts 83.0% 与三种融合（均 93.6%）。换语料后应重新用 eval 比较
 *   --rerank <值>         仅 hybrid 生效：rrf（默认）或 weighted
 *   --weights <a,b>       仅 hybrid + weighted 生效：权重顺序 [dense, fts]，默认 0.7,0.3
 *   --filter <表达式>     Zvec filter，字符串用单引号，如 "category = 'typescript-doc'"
 *   --no-collapse         关闭按 group 折叠（默认开启：同一 section 的多窗/outline 只保留引擎排在最前的那条）
 *   --full                打印完整正文而不是 200 字预览
 *   --json                输出 JSON，便于脚本消费
 *
 * eval 专用：
 *   --modes <a,b>         只跑指定配置标签，如 dense,hybrid-rrf
 *   --allow-missing       标注集里有期望来源不在库中时也继续跑（默认直接报错，避免指标失真）
 *
 * 示例：
 *   npm run chunk  -- ../Milvus/data --exclude jsx --export out.md
 *   npm run ingest -- ../Milvus/data --exclude jsx
 *   npm run query  -- "TypeScript 的类型有哪些" --topk 5
 *   npm run query  -- "协变和逆变" --mode fts
 */
import { readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { parseFile } from './parse/index.js'
import { DEFAULT_CHUNK_OPTIONS, documentToChunks } from './chunk/index.js'
import { renderReport, type FileReport } from './report.js'
import { embedTexts } from './embed/index.js'
import { chunkToDoc, deleteBySource, openStore, openStoreForRead, upsertDocs } from './store/zvec.js'
import { retrieve, type QueryMode, type RerankType } from './query/index.js'
import { evaluate, renderEvalReport, type LabeledSet } from './eval/index.js'
import type { ZVecCollection } from '@zvec/zvec'

const SUPPORTED_EXTENSIONS = /\.(md|mdx|markdown|docx|pdf|xlsx|pptx|odt|odp|ods|odg|rtf|csv|epub|html?)$/i

/** 不带值的开关。解析时不能吃掉后面的位置参数 */
const BOOLEAN_FLAGS = new Set(['quiet', 'rebuild', 'json', 'full', 'no-collapse', 'allow-missing'])

const QUERY_MODES: readonly QueryMode[] = ['hybrid', 'dense', 'fts']
const RERANK_TYPES: readonly RerankType[] = ['rrf', 'weighted']

/** 读一个数值型开关，非法时直接报错而不是悄悄用默认值 */
function numberFlag(flags: Map<string, string[]>, key: string, fallback: number): number {
    const raw = flags.get(key)?.[0]
    if (raw === undefined) {
        return fallback
    }
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`--${key} 需要一个正数，收到：${raw}`)
    }
    return value
}

/** 读一个枚举型开关，只接受白名单取值 */
function enumFlag<T extends string>(
    flags: Map<string, string[]>,
    key: string,
    allowed: readonly T[],
    fallback: T
): T {
    const raw = flags.get(key)?.[0]
    if (raw === undefined) {
        return fallback
    }
    const matched = allowed.find((item) => item === raw)
    if (matched === undefined) {
        throw new Error(`--${key} 只支持 ${allowed.join(' / ')}，收到：${raw}`)
    }
    return matched
}

/** 读形如 `0.7,0.3` 的权重对 */
function weightsFlag(flags: Map<string, string[]>): [number, number] | undefined {
    const raw = flags.get('weights')?.[0]
    if (raw === undefined) {
        return undefined
    }
    const parts = raw.split(',').map((part) => Number(part.trim()))
    if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part) || part < 0)) {
        throw new Error(`--weights 需要两个非负数、逗号分隔，例如 0.7,0.3，收到：${raw}`)
    }
    return [parts[0] ?? 0, parts[1] ?? 0]
}

interface Options {
    command: string
    target: string
    excludes: string[]
    export?: string | undefined
    category: string
    owner: string
    version: string
    limit?: number | undefined
    quiet: boolean
    /** ingest：collection 目录 */
    db: string
    /** ingest：向量维度 */
    dimensions: number
    /** ingest：embedding 单次请求条数 */
    batchSize: number
    /** ingest：删除现有 collection 重建 */
    rebuild: boolean
    /** query：返回条数 */
    topk: number
    /** query：检索模式 */
    mode: QueryMode
    /** query：hybrid 模式的融合方式 */
    rerank: RerankType
    /** query：weighted 融合权重 [dense, fts] */
    weights?: [number, number] | undefined
    /** query：Zvec filter 表达式 */
    filter?: string | undefined
    /** query：输出 JSON */
    json: boolean
    /** query：打印完整正文 */
    full: boolean
    /** query：关闭 group 折叠 */
    noCollapse: boolean
    /** eval：只跑指定的配置标签（逗号分隔） */
    modes?: string[] | undefined
    /** eval：即使标注集的期望来源不在库里也继续跑 */
    allowMissing: boolean
}

function parseArgs(argv: string[]): Options {
    const positional: string[] = []
    const flags = new Map<string, string[]>()

    for (let index = 0; index < argv.length; index++) {
        // 循环上界保证 index 有效；?? '' 只是收窄类型，不改变行为
        const token = argv[index] ?? ''
        if (!token.startsWith('--')) {
            positional.push(token)
            continue
        }
        const [rawKey, inlineValue] = token.slice(2).split('=')
        // split('=') 至少返回一个元素，rawKey 必然存在
        const key = rawKey ?? ''
        let value = inlineValue ?? 'true'
        const next = argv[index + 1]
        // 布尔开关不消费下一个 token：否则 `chunk --quiet <目录>` 会把目录当成 quiet 的值，
        // 位置参数被吃掉后直接报「用法」错误。
        if (inlineValue === undefined && !BOOLEAN_FLAGS.has(key) && next && !next.startsWith('--')) {
            index += 1
            value = next
        }
        flags.set(key, [...(flags.get(key) ?? []), value])
    }

    const command = positional[0] ?? ''
    const target = positional[1] ?? ''
    if (!command || !target) {
        throw new Error(
            '用法：tsx src/cli.ts chunk <目录或文件> [--exclude 路径段] [--export 路径] [--category 值] [--owner 值] [--version 值] [--limit n] [--quiet]'
        )
    }

    const limitRaw = flags.get('limit')?.[0]
    return {
        command,
        target,
        excludes: flags.get('exclude') ?? [],
        export: flags.get('export')?.[0],
        category: flags.get('category')?.[0] ?? 'unknown',
        owner: flags.get('owner')?.[0] ?? 'unknown',
        version: flags.get('version')?.[0] ?? 'v1',
        limit: limitRaw ? Number(limitRaw) : undefined,
        quiet: flags.has('quiet'),
        db: flags.get('db')?.[0] ?? './zvec-data/myrag',
        dimensions: numberFlag(flags, 'dim', 1024),
        batchSize: numberFlag(flags, 'batch', 64),
        rebuild: flags.has('rebuild'),
        topk: numberFlag(flags, 'topk', 5),
        mode: enumFlag(flags, 'mode', QUERY_MODES, 'dense'),
        rerank: enumFlag(flags, 'rerank', RERANK_TYPES, 'rrf'),
        weights: weightsFlag(flags),
        filter: flags.get('filter')?.[0],
        json: flags.has('json'),
        full: flags.has('full'),
        noCollapse: flags.has('no-collapse'),
        allowMissing: flags.has('allow-missing'),
        modes: flags
            .get('modes')?.[0]
            ?.split(',')
            .map((mode) => mode.trim())
            .filter((mode) => mode.length > 0),
    }
}

/**
 * 计算文件的来源标识：相对入库根目录的路径，统一用 / 分隔。
 *
 * 不能用 basename —— 语料里存在同名文件（compiler/overview.md 与 typings/overview.md），
 * 用 basename 会让后灌的文件把先灌的同名文件的 chunk 删掉。
 */
function sourceKey(rootPath: string, filePath: string): string {
    const root = resolve(rootPath)
    const base = statSync(root).isDirectory() ? root : dirname(root)
    return relative(base, resolve(filePath)).split(/[\\/]/).join('/')
}

function collectFiles(target: string, excludes: string[]): string[] {
    const absolute = resolve(target)
    const stats = statSync(absolute)
    const files: string[] = []

    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === '.git') continue
            const path = join(dir, entry.name)
            if (entry.isDirectory()) {
                walk(path)
                continue
            }
            if (!SUPPORTED_EXTENSIONS.test(entry.name)) continue
            // 排除规则按「路径段精确匹配」：--exclude jsx 只干掉名为 jsx 的目录，
            // 不会误伤 faqs/jsx-and-react.md 这类文件名里含 jsx 的合法文件。
            const segments = path.split(/[\\/]/).map((segment) => segment.toLowerCase())
            if (excludes.some((exclude) => segments.includes(exclude.toLowerCase()))) continue
            files.push(path)
        }
    }

    if (stats.isDirectory()) {
        walk(absolute)
    } else if (SUPPORTED_EXTENSIONS.test(absolute)) {
        files.push(absolute)
    }

    return files.sort()
}

function median(values: number[]): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)] ?? 0
}

async function runChunk(options: Options): Promise<number> {
    const files = collectFiles(options.target, options.excludes)
    if (files.length === 0) {
        console.error('没有匹配到任何可解析的文档。')
        return 1
    }

    const targets = options.limit ? files.slice(0, options.limit) : files
    console.log(`匹配到 ${files.length} 个文档${options.limit ? `，本次只处理前 ${targets.length} 个` : ''}`)
    if (options.excludes.length > 0) {
        console.log(`排除规则：${options.excludes.join(' / ')}`)
    }
    console.log('')

    const reports: FileReport[] = []
    const failures: Array<{ file: string; message: string }> = []
    const startedAt = Date.now()

    for (const path of targets) {
        try {
            const doc = await parseFile(path)
            const chunks = documentToChunks(doc, {
                category: options.category,
                owner: options.owner,
                sourceVersion: options.version,
            })
            reports.push({ path, doc, chunks })
            if (!options.quiet) {
                const sizes = chunks.map((chunk) => chunk.content.length)
                const frontMatter = doc.frontMatter
                    ? `  [front-matter: ${Object.entries(doc.frontMatter)
                          .map(([key, value]) => `${key}=${value}`)
                          .join(' ')}]`
                    : ''
                console.log(
                    `  ${doc.fileName.padEnd(34)} sections=${String(doc.sections.length).padStart(3)}  chunks=${String(
                        chunks.length
                    ).padStart(3)}  中位=${String(median(sizes)).padStart(4)}  最大=${String(Math.max(0, ...sizes)).padStart(4)}${frontMatter}`
                )
                // 解析警告（如无法归一化的兼容字符）必须打出来，否则文本静默降级
                for (const warning of doc.warnings) {
                    console.log(`      ⚠ ${warning}`)
                }
            }
        } catch (error) {
            failures.push({ file: path, message: (error as Error).message })
        }
    }

    const allSizes = reports.flatMap((report) => report.chunks.map((chunk) => chunk.content.length))
    const tiny = allSizes.filter((size) => size < 100).length
    const kindCounts = new Map<string, number>()
    for (const report of reports) {
        for (const chunk of report.chunks) {
            kindCounts.set(chunk.metadata.kind, (kindCounts.get(chunk.metadata.kind) ?? 0) + 1)
        }
    }

    console.log('')
    console.log('=== 汇总 ===')
    console.log(`成功 ${reports.length} 个文件　失败 ${failures.length} 个　耗时 ${Date.now() - startedAt} ms`)
    console.log(`chunk 总数 ${allSizes.length}　中位 ${median(allSizes)}　最大 ${Math.max(0, ...allSizes)}　<100 字符 ${tiny} (${((tiny / Math.max(1, allSizes.length)) * 100).toFixed(1)}%)`)
    console.log(`类型分布：${[...kindCounts.entries()].map(([kind, count]) => `${kind}×${count}`).join('  ')}`)

    if (failures.length > 0) {
        console.log('')
        console.log('失败文件：')
        for (const failure of failures.slice(0, 10)) {
            console.log(`  ✗ ${failure.file.split(/[\\/]/).pop()}：${failure.message.slice(0, 140)}`)
        }
    }

    if (options.export) {
        const output = renderReport(reports, `MyRAG 分块明细（${options.target}）`, DEFAULT_CHUNK_OPTIONS)
        writeFileSync(resolve(options.export), output, 'utf8')
        console.log('')
        console.log(`明细已导出：${resolve(options.export)}（${(output.length / 1024).toFixed(1)} KB）`)
    }


    return failures.length > 0 ? 1 : 0
}

/**
 * 解析 → 分块 → embedding → 写入 Zvec。
 *
 * 与 runChunk 的关键结构差异：**逐文件流式处理，不把所有 chunk 攒在内存里**。
 * 每个文件的处理顺序也是刻意设计的：
 *   1. 先 parse + chunk
 *   2. 再对该文件全部 chunk 做 embedding —— 这一步失败就直接跳过该文件，已有数据不受影响
 *   3. 然后删掉该 source 的旧 chunk（文件变短时避免残留过期数据）
 *   4. 最后写入
 * 也就是说「删旧 + 写新」不是原子操作，中途崩溃会留下该文件的数据缺口，
 * 但重跑即可修复（upsertSync 按 id 幂等）。
 */
async function runIngest(options: Options): Promise<number> {
    if (!process.env.Z_API_KEY?.trim()) {
        console.error('缺少 Z_API_KEY。ingest 需要调用 embedding 接口，请用 --env-file 指定 .env（npm run ingest 已配置）。')
        return 1
    }

    const files = collectFiles(options.target, options.excludes)
    if (files.length === 0) {
        console.error('没有匹配到任何可解析的文档。')
        return 1
    }
    const targets = options.limit ? files.slice(0, options.limit) : files
    const dbPath = resolve(options.db)

    console.log(`collection 目录：${dbPath}`)
    if (options.rebuild) {
        console.log('--rebuild：将删除该目录后重建，现有数据会全部丢失')
    }

    const { collection, created } = openStore({
        path: dbPath,
        dimensions: options.dimensions,
        rebuild: options.rebuild,
    })
    console.log(created ? '已新建 collection' : '已打开现有 collection')
    console.log(
        `维度 ${options.dimensions}　batchSize ${options.batchSize}　待处理 ${targets.length} 个文档` +
            (options.limit ? `（共匹配 ${files.length} 个，已限制）` : '')
    )
    console.log('')

    let totalChunks = 0
    let totalWritten = 0
    let totalCleared = 0
    let totalTokens = 0
    let totalRequests = 0
    let docCount = 0
    const failures: Array<{ file: string; message: string }> = []
    const startedAt = Date.now()

    try {
        for (const path of targets) {
            // 来源标识用相对路径而不是 basename，否则同名文件会互相覆盖
            const source = sourceKey(options.target, path)
            try {
                const doc = await parseFile(path)
                const chunks = documentToChunks(doc, {
                    category: options.category,
                    owner: options.owner,
                    sourceVersion: options.version,
                    source,
                })
                if (chunks.length === 0) {
                    if (!options.quiet) {
                        console.log(`  ${source.padEnd(34)} 无 chunk，跳过`)
                    }
                    continue
                }

                // 先完成该文件的全部 embedding：这一步失败就不动已有数据
                const embedded = await embedTexts(
                    chunks.map((chunk) => chunk.embedText),
                    { dimensions: options.dimensions, batchSize: options.batchSize }
                )

                // 再清掉该来源的旧 chunk，最后写入
                const cleared = deleteBySource(collection, source)
                const written = upsertDocs(
                    collection,
                    chunks.map((chunk, index) => chunkToDoc(chunk, embedded.vectors[index] ?? []))
                )

                totalChunks += chunks.length
                totalWritten += written.ok
                totalCleared += cleared
                totalTokens += embedded.promptTokens
                totalRequests += embedded.requests

                if (written.failed.length > 0) {
                    failures.push({
                        file: source,
                        message: `${written.failed.length} 条写入失败，例如 ${written.failed[0]?.id}：${written.failed[0]?.message}`,
                    })
                }

                if (!options.quiet) {
                    console.log(
                        `  ${source.padEnd(34)} chunks=${String(chunks.length).padStart(3)}` +
                            `  写入=${String(written.ok).padStart(3)}  清旧=${String(cleared).padStart(3)}` +
                            `  tokens=${String(embedded.promptTokens).padStart(5)}`
                    )
                }
                // 解析警告必须打出来，否则文本静默降级（例如残留的 CJK 兼容字符会让关键词检索失配）
                for (const warning of doc.warnings) {
                    console.log(`      ⚠ ${warning}`)
                }
            } catch (error) {
                failures.push({ file: source, message: (error as Error).message })
            }
        }
    } finally {
        // Zvec 写是单进程独占，必须关闭，否则下次打开会被锁挡住
        docCount = collection.stats.docCount
        collection.closeSync()
    }

    console.log('')
    console.log('=== 汇总 ===')
    console.log(`处理 ${targets.length} 个文件　失败 ${failures.length} 个　耗时 ${Date.now() - startedAt} ms`)
    console.log(`chunk 总数 ${totalChunks}　写入 ${totalWritten}　清掉旧 chunk ${totalCleared}`)
    console.log(`embedding：${totalRequests} 次请求　${totalTokens} prompt tokens`)
    console.log(`collection 现有文档数：${docCount}`)

    if (failures.length > 0) {
        console.log('')
        console.log('失败明细：')
        for (const failure of failures.slice(0, 10)) {
            console.log(`  ✗ ${failure.file}：${failure.message.slice(0, 200)}`)
        }
    }

    return failures.length > 0 ? 1 : 0
}

/**
 * 检索。注意：query 命令的位置参数是**问题本身**（不是目录或文件）
 *   npm run query -- "TypeScript 的类型有哪些" --topk 5
 *
 * 默认 hybrid（dense + FTS）+ rrf 融合 + 按 group 折叠。
 * filter 用 Zvec 语法，字符串要单引号：--filter "category = 'typescript-doc'"
 */
async function runQuery(options: Options): Promise<number> {
    const dbPath = resolve(options.db)

    let collection: ZVecCollection
    try {
        collection = openStoreForRead(dbPath)
    } catch (error) {
        console.error((error as Error).message)
        return 1
    }

    try {
        const result = await retrieve(collection, {
            question: options.target,
            topk: options.topk,
            mode: options.mode,
            rerank: options.rerank,
            weights: options.weights,
            filter: options.filter,
            collapseGroups: !options.noCollapse,
        })

        if (options.json) {
            console.log(JSON.stringify(result, null, 2))
            return 0
        }

        console.log(`提问：${result.question}`)
        console.log(
            `模式 ${result.mode}${result.rerank ? `(${result.rerank})` : ''}　topk ${result.topk}　` +
                `filter ${result.filter ?? '(无)'}　候选 ${result.rawCount}　耗时 ${result.tookMs} ms　` +
                `库内文档 ${collection.stats.docCount}`
        )
        console.log('')

        if (result.hits.length === 0) {
            console.log('无命中。')
            return 0
        }

        result.hits.forEach((hit, index) => {
            console.log(
                `[${index + 1}] score=${hit.score.toFixed(4)}　${hit.source}　chunk#${hit.chunkIndex}　${hit.kind}`
            )
            console.log(
                `    scope=${hit.scope ?? '(无)'}　heading=${hit.heading ?? '(无)'}` +
                    (hit.pageNumbers.length > 0 ? `　页码=${JSON.stringify(hit.pageNumbers)}` : '') +
                    (hit.group ? `　group=${hit.group}` : '')
            )
            const body = options.full ? hit.content : hit.content.replace(/\s+/g, ' ').slice(0, 200)
            console.log(`    ${body}${options.full ? '' : '…'}`)
            console.log('')
        })
    } finally {
        collection.closeSync()
    }

    return 0
}

/**
 * 收集 collection 里出现过的所有 source。
 * 用于校验标注集的 expectSources 是否真的都在库里 —— 来源不存在时那些 query 必然失败，
 * 会让指标彻底失真（这个坑踩过一次：期望 报告.docx 但当时只灌了 Milvus/data）。
 */
function collectSources(collection: ZVecCollection): Set<string> {
    const sources = new Set<string>()
    for (const doc of collection.iterDocsSync()) {
        const source = doc.fields?.source
        if (typeof source === 'string' && source.length > 0) {
            sources.add(source)
        }
    }
    return sources
}

/**
 * 检索评测。位置参数是**标注集 JSON 的路径**
 *   npm run eval -- eval/queries.json
 *
 * 默认对比 5 个配置（dense / fts / hybrid-rrf / weighted 0.7,0.3 / weighted 0.9,0.1），
 * 输出 hit@k、MRR，以及逐条 query 在各配置下的排名，最后列出未命中明细。
 * 用 --modes dense,hybrid-rrf 可以只跑其中几个。
 */
async function runEval(options: Options): Promise<number> {
    const dbPath = resolve(options.db)
    const setPath = resolve(options.target)

    let set: LabeledSet
    try {
        set = JSON.parse(readFileSync(setPath, 'utf8')) as LabeledSet
    } catch (error) {
        console.error(`读取标注集失败：${(error as Error).message}`)
        return 1
    }

    if (!Array.isArray(set.queries) || set.queries.length === 0) {
        console.error(`标注集里没有 queries 数组：${setPath}`)
        return 1
    }
    for (const query of set.queries) {
        const valid =
            typeof query.question === 'string' &&
            query.question.trim().length > 0 &&
            Array.isArray(query.expectSources) &&
            query.expectSources.length > 0
        if (!valid) {
            console.error(`标注格式不对（缺 question 或 expectSources）：${JSON.stringify(query).slice(0, 140)}`)
            return 1
        }
    }

    let collection: ZVecCollection
    try {
        collection = openStoreForRead(dbPath)
    } catch (error) {
        console.error((error as Error).message)
        return 1
    }

    try {
        // 先校验标注集的期望来源都在库里：来源不存在时那些 query 必然失败，指标会失真
        const sources = collectSources(collection)
        const missing = new Map<string, string[]>()
        for (const query of set.queries) {
            for (const source of query.expectSources) {
                if (sources.has(source)) continue
                missing.set(source, [...(missing.get(source) ?? []), query.id ?? query.question])
            }
        }
        if (missing.size > 0) {
            console.error(
                `标注集里有 ${missing.size} 个期望来源不在 collection 中（库内共 ${sources.size} 个来源）：`
            )
            for (const [source, queries] of missing) {
                console.error(`  ✗ ${source}　← ${queries.join(', ')}`)
            }
            if (!options.allowMissing) {
                console.error('')
                console.error('这些 query 必然失败，会让指标失真。请先灌入对应文档（npm run ingest），')
                console.error('或核对 expectSources 是否写对。加 --allow-missing 可强行继续。')
                return 1
            }
            console.error('（已指定 --allow-missing，继续执行；这些 query 会计为未命中）')
            console.error('')
        }

        const startedAt = Date.now()
        const reports = await evaluate(collection, set, {
            topk: options.topk,
            filter: options.filter,
            collapseGroups: !options.noCollapse,
            modes: options.modes,
        })

        if (options.json) {
            console.log(
                JSON.stringify({ set: setPath, collection: dbPath, topk: options.topk, reports }, null, 2)
            )
            return 0
        }

        console.log(`标注集：${setPath}　${set.queries.length} 条 query`)
        console.log(
            `collection：${dbPath}　库内文档 ${collection.stats.docCount}　topk ${options.topk}　` +
                `filter ${options.filter ?? '(无)'}　group 折叠 ${options.noCollapse ? '关' : '开'}`
        )
        console.log(`耗时 ${Date.now() - startedAt} ms`)
        console.log('')
        console.log(renderEvalReport(reports, options.topk))
    } finally {
        collection.closeSync()
    }

    return 0
}

async function main() {
    const options = parseArgs(process.argv.slice(2))

    switch (options.command) {
        case 'chunk':
            process.exitCode = await runChunk(options)
            return
        case 'ingest':
            process.exitCode = await runIngest(options)
            return
        case 'query':
            process.exitCode = await runQuery(options)
            return
        case 'eval':
            process.exitCode = await runEval(options)
            return
        default:
            console.error(`未知命令：${options.command}（支持 chunk / ingest / query / eval）`)
            process.exitCode = 1
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
})
