import type { MilvusClient } from "@zilliz/milvus2-sdk-node";

/**
 * 
 * @数据库创建
 * 多租户策略，数据隔离
 * Zilliz Cloud免费版只支持一个默认数据库
 */


/**
 * @查看数据库或者数据库列表
 */
export async function listDatabases(client: MilvusClient) {
    try {
        let res = await client.listDatabases()
        console.log(res)
    } catch (e) {
        console.log('查看数据库失败', e)
    }
}





