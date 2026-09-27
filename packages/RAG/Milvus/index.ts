import { MilvusClient, type CheckHealthResponse } from "@zilliz/milvus2-sdk-node";
import { connectTest } from './connect.js'
import { ensureCollection, listCollection, describeCollectionFields, insertCollection } from './collection.js'
import { listDatabases } from './database.js'
import { searchQuestion } from './search.js'
import { entityCount } from './entity.js'

import { AddEmbeddingProperty } from '../rag-chunk/src/embedding/embedding.js'
import { readAllMDFiles } from '../rag-chunk/src/file/read.js'
import { markdown_chunk } from '../rag-chunk/src/chunk/markdown/index.js'

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
    // describeCollectionFields(client, collectionName)
    // 查询collection的实体数
    entityCount(client, collectionName)
}

if (process.argv[2] == 'insert') {
    let mds = await readAllMDFiles('C:\\Users\\Lenovo\\Desktop\\project\\AgentCode\\src\\RAG\\Milvus\\data')
    for (let i = 0; i < mds.length; i++) {
        let chunk = markdown_chunk(mds[i]?.fileName!, mds[i]?.content!)
        let embedding_data = await AddEmbeddingProperty(chunk, 256, 'content')
        let res = await insertCollection(client, collectionName, embedding_data)
        console.log(res)
    }
    // 写入磁盘
    await client.flush({
        collection_names: [collectionName]
    })
}


if (process.argv[2] == 'search') {
    let res = await searchQuestion(client, collectionName, 'ts的类型有哪些', '', dimensions)
    console.log(res)
}




