/**
 * @VectorRetriever
 * 把“查询”转换成向量、并在向量库中找出最相似条目的组件
 * 本质做的是近邻搜索，距离相似度和余弦相似度
 * 而不是传统数据库查询的关键词匹配
 */

import { cosSimlarity } from "./similarityMethod.js";
import { embeddingZ } from "../embeddingZ.js";



/***
 * @这里只是普通文字文档
 * 如果是文件 txt data word pdf
 * 如果是音频
 * 
 */
export const documents = [
    {
        id: 'blue-whale-refund-rule',
        title: '蓝鲸退款规则',
        content: `普通商品签收后 7 天内可以申请退款。
生鲜商品不支持无理由退款。
退款金额超过 2000 元时，需要人工审核。`
    },
    {
        id: 'refund-apply-process',
        title: '退款申请流程',
        content: `用户可以在订单详情页提交退款申请。
系统会先校验订单状态、签收时间和商品类型。
需要人工审核的退款申请，会进入客服审核队列。`
    },
    {
        id: 'shipping-policy',
        title: '商品发货规则',
        content: `现货商品将在付款后 48 小时内发货。
偏远地区可能增加 1 到 3 天配送时间。`
    },
    {
        id: 'invoice-policy',
        title: '电子发票规则',
        content: `订单完成后可以申请电子发票。
企业发票需要提供公司抬头和税号。`
    },
    {
        id: 'warranty-policy',
        title: '售后保修规则',
        content: `电器商品享受 1 年整机保修。
人为损坏、进水和自行拆机不在免费保修范围内。`
    },
    {
        id: 'coupon-policy',
        title: '优惠券使用规则',
        content: `优惠券需要在有效期内使用。
已经过期的优惠券不能恢复，也不能兑换成现金。`
    }
]

async function buildMemoryVectorStore(rawDocuments) {
    const vectors = []
    for (const document of rawDocuments) {
        let vector = await embeddingZ(document.content)
        vectors.push(vector)
    }

    return rawDocuments.map((document, index) => ({
        ...document,
        vector: vectors[index]
    }))
}


async function createSimilarity(question) {
    let q_v = await embeddingZ(question)
    let similarPercent = new Array(documents.length).fill(0)
    return similarPercent.map((item, index) => cosSimlarity(q_v, vectorDocument[index].vector))
}

if (process.argv[2] === 'test') {
    let vectorDocument = await buildMemoryVectorStore(documents)
    //  console.log(vectorDocument)
    let question = '我买的咖啡机 3000 元，现在想退货。这个订单需要人工审核吗？如果要退，具体流程怎么走？'
    // '我买的咖啡机 3000 元，现在想退货。这个订单需要人工审核吗？如果要退，具体流程怎么走？'
    // '我去年的3千块的券现在能用吗'
    // '这个包售后吗 时限是多久，维修范围是哪些，是以旧换新还是维修'
    let res = await createSimilarity(question)
    console.log('搜索：', question)
    console.table(res.map((item, index) => {
        return {
            title: documents[index].title,
            //  content: documents[index].content,
            similarPercent: item
        }
    }).sort((a, b) => b.similarPercent - a.similarPercent))
}

