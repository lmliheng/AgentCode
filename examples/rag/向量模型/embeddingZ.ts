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
 * @向量模型
 * 
 * 
 */
export async function embeddingZ(str: string | number[], dimensions: number = 512): Promise<embeddingResponse> {

    let demensions_support = new Set([256, 512, 1024])
    let apikey = process.env.Z_API_KEY
    if (apikey === undefined) {
        throw new Error('缺少apikey')
    }
    if (!demensions_support.has(dimensions)) {
        throw new Error('向量维度仅支持256，512，1024')

    }
    if (Array.isArray(str) && str.length >= 64) {
        throw new Error('数组长度超出64')
    }

    let data = {
        model: "embedding-3",
        input: str,
        dimensions: dimensions,
    }

    try {

        const response = await fetch('https://open.bigmodel.cn/api/paas/v4/embeddings', {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.Z_API_KEY}`
            },
            body: JSON.stringify(data),
        })
        let res = await response.json()
        // .data[0].embedding
        return res

    } catch (e) {
        throw new Error(JSON.stringify(e))
    }
}


