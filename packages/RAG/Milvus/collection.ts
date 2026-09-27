import { DataType, IndexType, MetricType, MilvusClient } from "@zilliz/milvus2-sdk-node";
import { ca } from "zod/locales";

/**
 * 
 * 
 * 确保 Milvus Collection 存在。
 *
 * 如果 Collection 已存在：
 * - RESET_COLLECTION=true：先删除，再重新创建；
 * - 否则：直接 load 到内存，供后续检索使用。
 *
 * 如果 Collection 不存在：
 * - 创建 Collection；
 * - 创建向量索引；
 * - load Collection。
 */
export async function ensureCollection(client: MilvusClient, collection_name: string) {
    try {
        let CollectionName = collection_name
        const exists = await client.hasCollection({
            collection_name: CollectionName
        })

        if (exists.value) {
            console.log(`${CollectionName}已经存在，准备加载到内存`)
            // Collection 已存在时，加载到内存后即可使用。
            await client.loadCollection({ collection_name: CollectionName })
            return
        }

        console.log(`${CollectionName}不存在，创建collection并加载到内存`)

        await client.createCollection({
            collection_name: CollectionName,
            fields: [
                {
                    // 真正用于向量检索的字段。
                    // dim 必须和 Embedding API 返回的向量维度一致。
                    name: 'embedding',
                    data_type: DataType.FloatVector,
                    dim: 256
                },
                {
                    // Chunk 的唯一 ID，作为主键。
                    name: 'chunkId',
                    data_type: DataType.VarChar,
                    is_primary_key: true,
                    max_length: 256
                },
                {
                    // Chunk 原文内容，检索命中后需要返回给大模型作为上下文。
                    name: 'content',
                    data_type: DataType.VarChar,
                    max_length: 10000
                },
                {
                    name: 'metadata',
                    data_type: DataType.JSON,
                    max_length: 28000
                }

            ],
            index_params: [
                {
                    // 给 embedding 字段创建向量索引。
                    field_name: 'embedding',

                    // AUTOINDEX 让 Milvus / Zilliz 自动选择合适的索引策略。
                    index_type: IndexType.AUTOINDEX,

                    // 使用余弦相似度，适合大多数文本向量检索场景。
                    metric_type: MetricType.COSINE
                }
            ]
        })

        // 创建完成后，需要 load 到内存，后续才能执行 search。
        await client.loadCollection({ collection_name: CollectionName })
        console.log(` ${CollectionName} 创建并加载成功`)

    } catch (error) {
        // 统一错误处理
        console.error(` 操作集合 ${collection_name} 失败:`, error)
    }
}


/**
 * @查看collections
 */
export async function listCollection(client: MilvusClient) {
    try {
        let res = await client.listCollections()
        console.log(res)
    } catch (e) {
        console.log('查询collection失败:', e)
    }

}

/**
 * @查看指定 collection 的所有字段及其数据类型
 */
export async function describeCollectionFields(client: MilvusClient, collectionName: string) {
    try {
        // 获取集合的详细信息
        const res = await client.describeCollection({
            collection_name: collectionName
        })
        console.log(res)
    } catch (error) {
        console.error(` 查询集合 ${collectionName} 失败:`, error)
        throw error
    }
}

/**
 * @写入数据
 * 
 */
export async function insertCollection(client: MilvusClient, CollectionName: string, raw: any[]) {
    try {
        let res = await client.insert({
            collection_name: CollectionName,
            data: raw
        })
        console.log('写入成功：', res)
    } catch (e) {
        console.log("数据写入失败：", e)

    }
}