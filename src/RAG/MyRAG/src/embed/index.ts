/**
 * 智谱 embedding-3 客户端。
 *
 * 与旧实现（`src/RAG/rag-chunk/src/embedding/embedding.ts`）的差异，都是被实测问题逼出来的：
 *   1. **失败即抛，不静默降级**。旧实现把失败批次的 embedding 赋成 null 然后继续返回成功，
 *      结果索引里会出现没有向量的 chunk 而任务报成功。
 *   2. **校验返回条数与维度**。条数不匹配时直接抛错，不猜哪一条缺了。
 *   3. **限流/5xx 重试**（指数退避），网络异常也重试。
 *   4. 维度不再用白名单写死 —— 实测 API 接受 128~2048，白名单只会挡住合法调用。
 */

const API_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/embeddings'

/** 官方文档：单次请求最多 64 条 */
export const MAX_BATCH_SIZE = 64

export interface EmbedOptions {
    /** 向量维度。必须与 Zvec collection 的 schema 一致 */
    dimensions: number
    /** 单次请求条数，上限 64 */
    batchSize?: number
    /** 模型名 */
    model?: string
    /** 批次间隔毫秒数，用于规避限流 */
    delayMs?: number
    /** 单次请求超时毫秒数。不设超时会让挂住的请求把整个入库任务拖死 */
    timeoutMs?: number
    /** 显式传入的 API Key；不传则读环境变量 Z_API_KEY */
    apiKey?: string
}

export interface EmbedResult {
    /** 与输入顺序一致的向量 */
    vectors: number[][]
    /** 累计消耗的 prompt tokens，便于估算成本 */
    promptTokens: number
    /** 实际发起的请求次数 */
    requests: number
}

interface EmbeddingResponse {
    data?: Array<{ embedding?: number[]; index?: number }>
    usage?: { prompt_tokens?: number }
    error?: { message?: string }
    message?: string
}

/** 内部错误类型，用 retryable 区分「重试有意义」与「重试也白搭」 */
class EmbedError extends Error {
    readonly retryable: boolean

    constructor(message: string, retryable: boolean) {
        super(message)
        this.retryable = retryable
    }
}

function resolveApiKey(explicit?: string): string {
    const key = explicit ?? process.env.Z_API_KEY
    if (!key || key.trim().length === 0) {
        throw new Error('缺少 Z_API_KEY。请用 --env-file 指定 .env，或设置环境变量 Z_API_KEY。')
    }
    return key.trim()
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 单次请求。失败时抛出带 retryable 标记的 EmbedError */
async function requestOnce(texts: string[], context: {
    apiKey: string
    dimensions: number
    model: string
    timeoutMs: number
}): Promise<{ vectors: number[][]; promptTokens: number }> {
    let response: Response
    try {
        response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${context.apiKey}`,
            },
            body: JSON.stringify({
                model: context.model,
                input: texts,
                dimensions: context.dimensions,
            }),
            // 必须设超时：不设的话一次挂住的请求会把整个入库任务无限期拖住
            signal: AbortSignal.timeout(context.timeoutMs),
        })
    } catch (error) {
        // 网络异常与超时（TimeoutError）都属于可重试
        const name = error instanceof Error ? error.name : ''
        const label = name === 'TimeoutError' ? `超时（${context.timeoutMs} ms）` : '网络异常'
        throw new EmbedError(
            `embedding 请求失败（${label}）：${error instanceof Error ? error.message : String(error)}`,
            true
        )
    }

    const raw = await response.text()
    let body: EmbeddingResponse
    try {
        body = JSON.parse(raw) as EmbeddingResponse
    } catch {
        body = {}
    }

    if (!response.ok) {
        const detail = body.error?.message ?? body.message ?? raw.slice(0, 300)
        // 429 与 5xx 值得重试，4xx 其他情况（如鉴权失败、参数错误）重试无用
        const retryable = response.status === 429 || response.status >= 500
        throw new EmbedError(`embedding 接口返回 ${response.status}：${detail}`, retryable)
    }

    const data = body.data ?? []
    if (data.length !== texts.length) {
        // 带上原始响应片段，否则这种「200 但没有 data」的情况无法诊断
        throw new EmbedError(
            `embedding 返回条数不匹配：请求 ${texts.length} 条，返回 ${data.length} 条。` +
                `拒绝写入以避免索引与源数据错位。原始响应：${raw.slice(0, 300)}`,
            false
        )
    }

    const vectors = [...data]
        .sort((first, second) => (first.index ?? 0) - (second.index ?? 0))
        .map((item) => item.embedding ?? [])

    for (let index = 0; index < vectors.length; index++) {
        const vector = vectors[index] ?? []
        if (vector.length !== context.dimensions) {
            throw new EmbedError(
                `第 ${index + 1} 条的向量维度是 ${vector.length}，期望 ${context.dimensions}。请确认 dimensions 参数与 collection schema 一致。`,
                false
            )
        }
    }

    return { vectors, promptTokens: body.usage?.prompt_tokens ?? 0 }
}

/**
 * 批量向量化。按 batchSize 分批串行调用，任一批次彻底失败就抛错。
 * 调用方应先完成全部 embedding、再去写库，这样失败时不会破坏已有数据。
 */
export async function embedTexts(texts: string[], options: EmbedOptions): Promise<EmbedResult> {
    if (texts.length === 0) {
        return { vectors: [], promptTokens: 0, requests: 0 }
    }

    const batchSize = Math.min(options.batchSize ?? MAX_BATCH_SIZE, MAX_BATCH_SIZE)
    if (batchSize <= 0) {
        throw new Error(`batchSize 必须大于 0，当前 ${batchSize}`)
    }

    const context = {
        apiKey: resolveApiKey(options.apiKey),
        dimensions: options.dimensions,
        model: options.model ?? 'embedding-3',
        timeoutMs: options.timeoutMs ?? 60_000,
    }
    const delayMs = options.delayMs ?? 300
    const maxAttempts = 3

    const vectors: number[][] = []
    let promptTokens = 0
    let requests = 0

    for (let start = 0; start < texts.length; start += batchSize) {
        const batch = texts.slice(start, start + batchSize)

        for (let attempt = 1; ; attempt++) {
            try {
                const result = await requestOnce(batch, context)
                requests++
                promptTokens += result.promptTokens
                vectors.push(...result.vectors)
                break
            } catch (error) {
                // 网络异常（非 EmbedError）按可重试处理
                const retryable = error instanceof EmbedError ? error.retryable : true
                if (!retryable || attempt >= maxAttempts) {
                    throw error
                }
                await sleep(attempt * 1000)
            }
        }

        if (start + batchSize < texts.length && delayMs > 0) {
            await sleep(delayMs)
        }
    }

    return { vectors, promptTokens, requests }
}
