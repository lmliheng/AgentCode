/**
 * @测试
 * 
 */

import { ChatDeepSeek } from '@langchain/deepseek'
import { createAgent, tool } from 'langchain'
import * as z from 'zod'

/**
 * 定义订单状态查询 Tool。
 *
 * Agent 可以根据用户问题自主决定是否调用该工具。
 * schema 用于描述工具参数，帮助模型生成正确的 Tool Call。
 */
const getOrderStatus = tool(
    async ({ orderId }) => {
        // 模拟订单系统返回的查询结果。
        return JSON.stringify({
            orderId,
            status: 'waiting_for_manual_review',
            message: '退款金额超过 2000 元，正在等待人工审核'
        })
    },
    {
        name: 'get_order_status',
        description: '根据订单号查询当前处理状态',
        schema: z.object({
            orderId: z.string().describe('需要查询的订单号')
        })
    }
)

//默认读 process.env.DEEPSEEK_API_KEY
const model = new ChatDeepSeek({
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
    temperature: 0
})
/**
 * @创建Agent
 * 
 */
const agent = createAgent({
    model,
    tools: [getOrderStatus],
    systemPrompt: '你是订单客服，只能根据工具返回的数据回答。'
})


const result = await agent.invoke({
    messages: [
        {
            role: 'user',
            content: '查询订单 A1024 当前的处理状态'
        }
    ]
})

console.log(result.messages.at(-1)?.content)