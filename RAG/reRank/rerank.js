/**
 * @对检索后的数组进行再次排序
 * 
 * 我们使用的是rerank文本模型来完成这个重排序任务
 * 
 */

import { search_res } from './search_result.js'
import { documents } from '../向量检索器/VectorRetriever.js'

export async function raRank() {
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/rerank', {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.Z_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: 'rerank',
            query: '两年前买的机子还包售后吗,需要审核吗',
            documents: documents.map((item) => {
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
    console.log('向量检索查询结果：')
    console.table(search_res.map((item) => {
        return {
            score: item.score,
            title: item.title
        }
    }))
    console.log("重排序结果：")
    console.table(res.map((item, index) => {
        item.content = documents[item.index].title
        return item
    }
    ))
}
