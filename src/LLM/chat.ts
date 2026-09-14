import { callDeepSeek, getDeepseekBalance } from './deepseek_client.js'
import { MessageAdd, UserMessageCreate } from './message_tools.js'
import * as readline from 'readline'
import type { ChatMessage } from './deepseek_client.js'

if (process.argv[2] === 'chat') {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    })

    let message: ChatMessage[]
    function ask() {
        rl.question('user: ', async (answer) => {
            if (answer.toLowerCase() === 'stop') {
                rl.close()
                return
            }
            if (message === undefined) {
                message = UserMessageCreate(answer)
            } else {
                message = MessageAdd(message, answer, 'user')
            }
            let res = await callDeepSeek(message, {
                temperature: 0.9
            })
            console.log(res.message.content)
            // console.log(message)
            message = MessageAdd(message, res.message.content!, 'assistant')
            ask() // 递归继续对话
        })
    }
    ask()
}

if (process.argv[2] === 'balance') {
    let balance = await getDeepseekBalance()
    console.table(balance!.balance_infos)
}