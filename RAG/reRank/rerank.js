/**
 * @对检索后的数组进行再次排序
 * 
 * 我们使用的是rerank文本模型来完成这个重排序任务
 * 
 */

import { search_res } from './search_result.js'
import { documents, question } from '../向量检索器/VectorRetriever.js'

export async function raRank() {
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/rerank', {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.Z_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: 'rerank',
            query: question,
            documents: search_res.map((item) => {
                return `${item.title}:${item.content}`
            }),
            top_n: `${search_res.length}`
        })
    })
    let res = await response.json()
    return res
}

if (process.argv[2] === '--test') {
    let res = await raRank()
    res = res.results
    console.log('用户问题：', question)
    console.log('向量检索查询结果：')
    console.table(search_res.map((item) => {
        return {
            score: item.score,
            title: item.title,
            chunkHash: item.content_hash
        }
    }))
    console.log("重排序结果：")
    console.table(res.map((item, index) => {
        item.title = search_res[item.index].title
        item.chunkHash = search_res[item.index].content_hash
        return item
    }
    ))
}
