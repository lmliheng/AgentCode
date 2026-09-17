import type { MilvusClient } from '@zilliz/milvus2-sdk-node'
import { createEmbeddings } from '../rag-chunk/src/embedding/embedding.js'


export async function searchQuestion(client: MilvusClient, collectionName: string, question: string, filter: string, dimensions: 128 | 256 | 512) {
    const query = await createEmbeddings(question, dimensions)
    const result = await client.search({
        collection_name: collectionName,

        // 指定在哪个向量字段上做 ANN Search。
        anns_field: 'embedding',

        // 查询向量。传数组 Milvus 支持一次查多个向量。
        data: query,

        limit: 4,

        // Metadata Filter，例如：category == "refund"。
        filter,

        // 指定检索结果里需要返回哪些字段。
        output_fields: [
            'chunkId',
            'content',
            'metadata'
        ]
    })

    return result
}