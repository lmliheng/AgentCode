/**
 * @对检索后的数组进行再次排序
 * 
 * 我们使用的是rerank文本模型来完成这个重排序任务
 * 
 */


interface Item {
    title: string;
    content: string;
    [key: string]: unknown; // 允许其他任意属性
}

/**
 * @重排结果
 */
export interface reRankResult {
    index: number;
    relevance_score: number;
}

/**
 * @智谱接口返回
 */
interface reRankApiResponse {
    id: string;
    results: reRankResult[];
    meta?: Record<string, unknown>;
}

/**
 * 
 * @reRank模型
 * 使用智谱rerank模型
 * 
 * input： 用户提问，向量检索结果
 * 对检索结果的重排
 * 
 */
export async function raRank(question: string, search_result: Item[]): Promise<reRankResult[]> {
    try {
        const response = await fetch('https://open.bigmodel.cn/api/paas/v4/rerank', {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.Z_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: 'rerank',
                query: question,
                // 排序后数据的重要数据作为重排序评判
                documents: search_result.map((item) => {
                    return `${item.title}:${item.content}`
                }),
                top_n: `${search_result.length}`
            })
        })
        let res: reRankApiResponse = await response.json()
        return res.results
    } catch (e) {
        console.log(e)
        return []
    }

}


import { search_res } from './search_result.js'
if (process.argv[2] === '--test') {

    const question = '我买的咖啡机 3000 元，现在想退货。这个订单需要人工审核吗？如果要退，具体流程怎么走？'

    let res = await raRank(question, search_res)
    console.log('用户问题：', question)
    console.log('向量检索查询结果：')
    console.log(search_res)
    // console.table(search_res.map((item: any) => {
    //     return {
    //         score: item.score,
    //         title: item.title,
    //         chunkHash: item.content_hash
    //     }
    // }))
    console.log("重排序结果：")
    console.log(res)
}
