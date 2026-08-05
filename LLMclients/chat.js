// const { getDeepseekBalance } = require("./deepseek_client")
// ES 写法 这里会报错
// let balance=await getDeepseekBalance()
// async function testGetDeepseekBalance() {
//     try {
//         const balance = await getDeepseekBalance()
//         console.log(balance)
//     } catch (error) {
//         console.error('获取余额失败:', error.message)
//     }
// }
// testGetDeepseekBalance()
// async function testDeepseekChat(message) {
// }

import { callDeepSeek } from './deepseek_client.js'
import { messageAdd, messageCreate } from './message_tools.js'
import * as readline from 'readline'

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
})


let message
function ask() {
    rl.question('user: ', async (answer) => {
        if (answer.toLowerCase() === 'stop') {
            rl.close()
            return
        }
        if (message === undefined) {
            message = messageCreate(answer)
        } else {
            message = messageAdd(message, answer, 'user')
        }
        let res = await callDeepSeek(message)
        console.log(res.message.content)
        // console.log(message)
        message = messageAdd(message, res.message.content, 'assistant')
        ask() // 递归继续对话
    })
}

ask()