
import type { MilvusClient } from "@zilliz/milvus2-sdk-node";

/**
 * @查询collection内的实体数
 */

export async function entityCount(client: MilvusClient, collectionName: string, filter?: string) {
    const res = await client.count({
        collection_name: collectionName,
        expr: filter ?? " ", // 空字符串 = 不过滤，统计全部
    });

    console.log("实体数量:", res.data);
}