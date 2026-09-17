import { MilvusClient, type CheckHealthResponse } from "@zilliz/milvus2-sdk-node";
import { connectTest } from './connect.js'
import { ensureCollection, listCollection, describeCollectionFields, insertCollection } from './collection.js'
import { listDatabases } from './database.js'
import { searchQuestion } from './search.js'
import { AddEmbeddingProperty } from '../rag-chunk/src/embedding/embedding.js'
interface DataItem {
    chunkId: string,
    content: string,
    metadata: {
        source: string
        title: string
        category: string
        owner: string
        sourceVersion: string
        chunkIndex: number
        contentHash: string
        chunkLength: number
    }
}

let collectionName = 'test2'

let dimensions: 128 | 256 | 512 = 256

const client = new MilvusClient({
    address: process.env.MILVUS_ENDPOINT ?? 'http://100.69.0.14:19530',
    token: process.env.MILVUS_TOKEN ?? '',
    timeout: 10000
})


if (process.argv[2] == 'test') {
    connectTest(client)
}

if (process.argv[2] == 'collection') {
    ensureCollection(client, collectionName)
}

if (process.argv[2] == 'check') {
    // 查看数据库
    //  listDatabases(client)
    // 查看collection
    //  listCollection(client)
    // 
    describeCollectionFields(client, collectionName)
}

if (process.argv[2] == 'insert') {
    let data = [
        {
            "chunkId": "refund-policy:2026-06-15:001:e5aab452f79f",
            "content": "# 蓝鲸退款规则\n\n普通商品签收后 7 天内可以申请退款。\n\n生鲜商品不支持无理由退款。\n\n退款金额超过 3000 元时，需要进入人工审核流程。\n\n用户提交退款申请后，系统会先校验订单状态、签收时间和商品类型。",
            "metadata": {
                "source": "refund-policy.md",
                "title": "蓝鲸退款规则",
                "category": "refund",
                "owner": "customer-service",
                "sourceVersion": "2026-06-15",
                "chunkIndex": 1,
                "contentHash": "e5aab452f79f",
                "chunkLength": 105
            }
        }]
    let embedding_data = await AddEmbeddingProperty(data, 256, 'content')
    let res = await insertCollection(client, collectionName, embedding_data)
    await client.flush({
        collection_names: [collectionName]
    })
    console.log(res)
}


if (process.argv[2] == 'search') {
    let res = await searchQuestion(client, collectionName, '退款', '', dimensions)
    console.log(res)
}




