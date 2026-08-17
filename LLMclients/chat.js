import { callDeepSeek, getDeepseekBalance } from './deepseek_client.js'
import { messageAdd, messageCreate } from './message_tools.js'
import * as readline from 'readline'

if (process.argv[2] === 'chat') {
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
            let res = await callDeepSeek(message,{
                temperature:0.9
            })
            console.log(res.message.content)
            // console.log(message)
            message = messageAdd(message, res.message.content, 'assistant')
            ask() // 递归继续对话
        })
    }
    ask()
}

if (process.argv[2] === 'balance') {
    let balance = await getDeepseekBalance()
    console.table(balance.balance_infos)
}