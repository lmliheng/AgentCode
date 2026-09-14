/**
 * @连接到Milvus数据库
 */

import { MilvusClient } from "@zilliz/milvus2-sdk-node";

export const client = new MilvusClient({
    address: process.env.MILVUS_ENDPOINT ?? ' ',
    token: process.env.MILVUS_TOKEN ?? ' ',
    // username: process.env.MILVUS_USERNAME ?? ' ',
    // password: process.env.MILVUS_PASSWORD ?? ' ',
    timeout: 10000
})

