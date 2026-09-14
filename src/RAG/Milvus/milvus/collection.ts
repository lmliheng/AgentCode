import { type MilvusClient, DataType, IndexType, MetricType } from "@zilliz/milvus2-sdk-node";

/**
 * @创建collection
 * 
 */



/**
 * @确保 Milvus Collection 存在。
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
async function ensureCollection(client: MilvusClient) {
    let CollectionName = process.env.CollectionName ?? ''
    const exists = await client.hasCollection({
        collection_name: CollectionName
    })

    if (exists.value) {

        // Collection 已存在时，加载到内存后即可使用。
        await client.loadCollection({ collection_name: CollectionName })
        return

    }

    await client.createCollection({
        collection_name: CollectionName,
        fields: [
            {
                // Chunk 的唯一 ID，作为主键。
                name: 'chunk_id',
                data_type: DataType.VarChar,
                is_primary_key: true,
                max_length: 256
            },
            {
                // Chunk 原文内容，检索命中后需要返回给大模型作为上下文。
                name: 'content',
                data_type: DataType.VarChar,
                max_length: 4096
            },
            {
                // 原始文档来源，例如 refund-policy.md。
                name: 'source',
                data_type: DataType.VarChar,
                max_length: 512
            },
            {
                // 文档标题，例如“蓝鲸退款规则”。
                name: 'title',
                data_type: DataType.VarChar,
                max_length: 512
            },
            {
                // 文档分类，用于 Metadata Filter，例如 refund、shipping、invoice。
                name: 'category',
                data_type: DataType.VarChar,
                max_length: 128
            },
            {
                // 文档归属方，例如 customer-service。
                name: 'owner',
                data_type: DataType.VarChar,
                max_length: 128
            },
            {
                // 文档版本号，用于区分不同版本的知识。
                name: 'source_version',
                data_type: DataType.VarChar,
                max_length: 128
            },
            {
                // 当前 Chunk 在原文档里的顺序。
                name: 'chunk_index',
                data_type: DataType.Int32
            },
            {
                // 内容 hash，用于判断内容是否发生变化，也可以参与生成稳定的 chunk_id。
                name: 'content_hash',
                data_type: DataType.VarChar,
                max_length: 128
            },
            {
                // 真正用于向量检索的字段。
                // dim 必须和 Embedding API 返回的向量维度一致。
                name: 'embedding',
                data_type: DataType.FloatVector,
                dim: process.env.dimensions ?? 256
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
}