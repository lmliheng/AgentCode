/**
 *
 * @调用智谱embedding模型的API
 * input: Array<string> | string 数组长度最长64
 *
 */
export async function createEmbeddings(inputs, dimensions) {
    const supportedDimensions = new Set([128, 256, 512]);
    if (!process.env.Z_API_KEY) {
        throw new Error('没有检测到 ZHIPU_API_KEY，请先在 .env 中配置。');
    }
    // Embedding 维度必须是模型支持的维度。
    if (!supportedDimensions.has(dimensions)) {
        throw new Error('EMBEDDING_DIMENSIONS 只能是 128、256 或 512。');
    }
    // embedding-3 单次最多处理 64 条文本。
    // 如果真实项目里 Chunk 很多，需要自己做 batch 分批调用。
    if (inputs.length > 64) {
        throw new Error('embedding-3 单次请求的数组最大不能超过 64 条。');
    }
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/embeddings', {
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
    });
    const result = await response.json();
    if (!response.ok) {
        throw new Error(`Embedding API 调用失败：${response.status} ${JSON.stringify(result)}`);
    }
    // API 返回结果里带 index。
    // 这里先按 index 排序，确保返回向量顺序和 inputs 顺序一致。
    return result.data
        .sort((first, second) => first.index - second.index)
        .map((item) => item.embedding);
}
