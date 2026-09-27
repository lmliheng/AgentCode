import { callJev } from './jev_client.js'
import type { JevQuestion, JevState } from './jev_client.js'

/**
 * @Jev调用示例：客服工单分流
 * 每个问题只能问一件事，criteria 是给模型的判据
 */
const state: JevState = {
    ticket: '我点了付款，结算页就白屏了，换了两个浏览器都一样。',
    customer_tier: 'enterprise',
}

const questions: Record<string, JevQuestion> = {
    is_urgent: {
        type: 'noul',
        instructions: '这条消息是否表达了紧迫性？',
        criteria: {
            true: '明确提到时间敏感',
            false: '没有表达紧迫性',
        },
    },
    department: {
        type: 'choice',
        instructions: '该由哪个团队处理？',
        criteria: {
            billing: '支付、开票、退款',
            technical: '缺陷、故障、集成',
            sales: '定价、升级、新账号',
        },
    },
    frustration: {
        type: 'score',
        instructions: '客户有多不满？',
        criteria: ['平静', '不满', '非常愤怒'],
    },
}

if (process.argv[2] === 'jev') {
    const res = await callJev(state, questions)
    console.log(`model: ${res.model} | provider: ${res.provider} | ${res.latencyMs}ms`)
    console.log('usage:', res.usage)

    const { is_urgent, department, frustration } = res.answers
    if (is_urgent?.type === 'noul' && department?.type === 'choice' && frustration?.type === 'score') {
        // noul 是 0~1 的概率；choice 和 score 还带完整概率分布
        console.log(`紧迫度: ${is_urgent.noul}`)
        console.log(`归属: ${department.choice}`, department.probabilities)
        console.log(`不满度: ${frustration.score}`, frustration.legend)
        if (is_urgent.noul > 0.8 && department.choice === 'billing') {
            console.log('→ 升级给支付团队')
        }
    }
}
