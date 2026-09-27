/**
 * @提问优化器
 * 
 * 使用ds对用户提示词进行rewrite-query和muilti-query处理
 */

import { callDeepSeek } from '../../LLM/deepseek_client.js'
import { MessageAdd, SystemMessageCreate } from '../../LLM/message_tools.js'

import * as readline from 'readline'

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

let message = SystemMessageCreate('接下来只要我发给你的每一句话question，都只返回这种形式：{"rewrite":"question的标准语句(去除口语化)";"muilti":["类似问题1","类似问题2",...]}。例如这个例子,我发送"我这个订单两年前买的，哪个时候方便换货退钱，退一下要不要人工客服看一下",你返回{"rewrite":"退款金额 3500 元，是否需要人工审核";"muilti":["退款金额 3500 元是否需要人工审核？","退款金额超过多少需要人工审核？","售后退款流程中，哪些情况不能自动通过","高金额退款是否需要工作人员审核？"]},返回JSON.stringify格式，muilti中的句子最多有6个，能返回几个看你抉择，需要从不同角度去生成muilti')

/**
 * @暴露的提示词优化函数
 * 原理是调用模型，对提示词进行优化和多方面解析后 作为新的提示词
 * 
 */
export async function query_better(question: string) {
    message = MessageAdd(message, question, 'user')
    let res = await callDeepSeek(message)
    return res.message.content
}




if (process.argv[2] === '--test') {
    function ask() {
        rl.question('user:', async (anwser) => {
            if (anwser.toLowerCase() === 'stop') {
                rl.close()
                return
            }
            message = MessageAdd(message, anwser, 'user')
            let res = await callDeepSeek(message)
            let content = res.message.content
            console.log(content)
            message = MessageAdd(message, content!, 'assistant')
            ask()
        })
    }
    ask()
}

