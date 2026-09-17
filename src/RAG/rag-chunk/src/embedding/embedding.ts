import { da } from "zod/locales"

interface embeddingResponse {
    data: embeddingResponseData[],
    model: string
    object: string
    usage: { completion_tokens: 0, prompt_tokens: 8, total_tokens: 8 }
}

interface embeddingResponseData {
    embedding: number[],
    index: 0,
    object: 'embedding'
}

/**
 * 
 * @调用智谱embedding模型的API
 * input: Array<string> | string 数组长度最长64
 * 
 */
export async function createEmbeddings(inputs: Array<string> | string, dimensions: 128 | 256 | 512): Promise<number[][]> {

    if (!process.env.Z_API_KEY) {
        throw new Error('没有检测到 ZHIPU_API_KEY，请先在 .env 中配置。')
    }
    // embedding-3 单次最多处理 64 条文本。
    // 如果真实项目里 Chunk 很多，需要自己做 batch 分批调用。
    if (inputs.length > 64) {
        throw new Error('embedding-3 单次请求的数组最大不能超过 64 条。')
    }

    const response = await fetch(
        'https://open.bigmodel.cn/api/paas/v4/embeddings',
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.Z_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'embedding-3',
                input: inputs,
                dimensions: dimensions
            })
        }
    )

    const result: embeddingResponse = await response.json()

    if (!response.ok) {
        throw new Error(
            `Embedding API 调用失败：${response.status} ${JSON.stringify(result)}`
        )
    }

    return result.data
        .sort((first: any, second: any) => first.index - second.index)
        .map((item: any) => item.embedding)
}


export async function AddEmbeddingProperty(
    data: any[],
    dimensions: 128 | 256 | 512,
    property: string
) {
    try {

        if (!data[0].hasOwnProperty(property)) {
            throw new Error(`data 中缺少 ${property} 属性`)
        }

        const BATCH_SIZE = 64
        let successCount = 0
        let failCount = 0

        for (let i = 0; i < data.length; i += BATCH_SIZE) {
            const batch = data.slice(i, i + BATCH_SIZE)
            const texts = batch.map(item => item[property])
            try {
                const embeddings = await createEmbeddings(texts, dimensions)

                // 将 embedding 赋值回原数组
                embeddings.forEach((embedding: number[], j: number) => {
                    data[i + j].embedding = embedding
                })

                successCount += batch.length

            } catch (batchError) {

                failCount += batch.length
                // 为该批次的数据填充空的 embedding，避免后续流程出错
                batch.forEach((_, j) => {
                    data[i + j].embedding = null
                    data[i + j].error = `embedding 失败: ${(batchError as Error).message}`
                })
            }

            // 批次间延迟，避免触发 API 限流
            if (i + BATCH_SIZE < data.length) {
                console.log('等待 300ms 后处理下一批...')
                await new Promise(resolve => setTimeout(resolve, 300))
            }
        }
        if (failCount > 0) {
            console.warn(`有 ${failCount} 条数据处理失败，已标记错误信息`)
        }

        console.log('属性向量化成功.')
        return data

    } catch (error) {
        console.error('AddEmbeddingProperty 执行失败:', error)
        throw error
    }
}