/**
 * @连接到Milvus数据库
 */

import { MilvusClient, type CheckHealthResponse } from "@zilliz/milvus2-sdk-node";

export async function connectTest(client: MilvusClient) {
    try {
        const res: CheckHealthResponse = await client.checkHealth()
        console.log('Milvus health check result:', res)

        // 检查是否真的健康
        if (res.isHealthy) {
            console.log(' Milvus connection successful!')
        } else {
            console.warn(' Milvus responded but might not be healthy:', res)
        }

        return res
    } catch (error: any) {
        console.error(' Failed to connect to Milvus:', error.message)
        throw error
    }
}

