/**
 * 
 * @向量模型
 */
export async function embeddingZ(str, dimensions = 512) {

    let demensions_support = new Set([256, 512, 1024])

    let apikey = process.env.Z_API_KEY
    if (apikey === undefined) {
        return '缺少apikey'
    }
    if (!demensions_support.has(dimensions)) {
        return '向量维度仅支持256，512，1024'
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
        return res.data[0].embedding

    } catch (error) {
        console.log('请求出现错误：', error)
    }
}


