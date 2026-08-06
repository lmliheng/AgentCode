/**
 * @milvus
 * 
 */

import { readFile } from 'fs/promises'
import { client } from "./milvus/connect.js";
import { IndexType, MetricType, DataType } from "@zilliz/milvus2-sdk-node";
import { embeddingZ } from '../embeddingZ.js'

import path from 'path'
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const collectionName = 'sale'

/**
 * @检查是否存在sale collections
 * 存在就加载到内存，不存在就创建schema
 */
let exist = await client.hasCollection({
    collection_name: collectionName
})
if (exist.value) {
    await client.loadCollection({
        collection_name: collectionName
    })
} else {
    await client.createCollection({
        collection_name: collectionName,
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
                dim: 512
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
    await client.loadCollection({
        collection_name: collectionName
    })
}




function toRow(chunk, embedding) {
    return {
        chunk_id: chunk.chunkId,
        content: chunk.content,
        source: chunk.metadata.source,
        title: chunk.metadata.title,
        category: chunk.metadata.category,
        owner: chunk.metadata.owner,
        source_version: chunk.metadata.sourceVersion,
        chunk_index: chunk.metadata.chunkIndex,
        content_hash: chunk.metadata.contentHash,
        embedding
    }
}

/**
 * @用于检查milvus响应
 */
function ensureOk(response, action) {
    const status = response?.status ?? response
    const code = Number(status?.code ?? 0)
    const errorCode = status?.error_code
    if (code !== 0 || (errorCode && errorCode !== 'Success')) {
        throw new Error(`${action} 失败：${JSON.stringify(status)}`)
    } else {
        console.log('chunk写入成功')
    }
}


/**
 * @读取chunk.json
 */
let chunksFile = path.join(__dirname, '../chunk/output/chunks.json')
const rawText = await readFile(chunksFile, 'utf8')
let chunks = JSON.parse(rawText)
// 取出每个 Chunk 的正文内容，并批量调用 Embedding 模型生成向量。
// embeddings[index] 和 chunks[index] 是一一对应的。
// const embeddings = chunks.map(async (item) => {
//     let res = await embeddingZ(item.content)
//     return res
// })
const embeddings = await Promise.all(
    chunks.map(item => embeddingZ(item.content))
)
// 将 Chunk 元数据、正文内容、Embedding 向量组装成 Milvus 的写入格式。
// toRow 内部通常会把 chunk_id、source、content、version、vector 等字段整理成一行数据。
const rows = chunks.map((chunk, index) => toRow(chunk, embeddings[index]))
// 将整理好的 rows 批量写入 Milvus collection。
const result = await client.insert({
    collection_name: collectionName,
    data: rows
})
// 检查 Milvus 返回结果，确认本次写入是否成功。
ensureOk(result, '写入 Chunk')
// flushSync 会等待数据真正写入存储层。
// 这样可以避免刚 insert 完，数据还没完全落盘时就立刻去检索。
await client.flushSync({
    collection_names: [collectionName]
})
// 写入后重新 load collection。
// 目的是确保最新写入的数据进入可检索状态，后续 search 能查到新 Chunk。
await client.loadCollection({
    collection_name: collectionName
})

async function searchQuestion(client, question, filter) {
    const query = await embeddingZ(question)
    const result = await client.search({
        collection_name: collectionName,

        // 指定在哪个向量字段上做 ANN Search。
        anns_field: 'embedding',

        // 查询向量。这里传数组，是因为 Milvus 支持一次查多个向量。
        data: [query],

        // 返回最相似的前 3 条。
        limit: 3,

        // Metadata Filter，例如：category == "refund"。
        filter,

        // 指定检索结果里需要返回哪些字段。
        output_fields: [
            'chunk_id',
            'content',
            'source',
            'title',
            'category',
            'owner',
            'source_version',
            'chunk_index',
            'content_hash'
        ]
    })

    return result.results
}


if (process.argv[2] === '--search') {
    let question = '两年前买的机子还包售后吗'
    //'3000 元退款需要人工审核吗？'
    let searchResult = await searchQuestion(client, question, 'category == "refund"')
    console.log(searchResult)
}