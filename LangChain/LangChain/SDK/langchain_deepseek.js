import { ChatDeepSeek } from "@langchain/deepseek"
import { messageAdd, messageCreate } from '../../../LLMclients/message_tools.js'
import * as readline from 'readline'
/**
 * @langchain/deepseek:
 * 自动读取环境变量DEEPSEEK_API_AKI
 * 1. ChatDeepSeek 创建LLM对象 ds
 * 2. ds有方法： invoke 对话 ，
 * 
 */



/**
 * ds对象
 */
let deepseek = new ChatDeepSeek({
    model: 'deepseek-v4-flash',
})

/**
 * @单多轮对话
 * 可以看到invoke方法支持generate和chat两种对话格式
 * 
 */
if (process.argv[2] === '--generate') {
    console.log('单轮对话 generate过程 无上下文')
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    })

    function ask() {
        rl.question('user: ', async (answer) => {
            if (answer.toLowerCase() === 'stop') {
                rl.close()
                return
            }
            let res = await deepseek.invoke(answer)
            console.log(res.content)
            ask() // 递归继续对话
        })
    }
    ask()
}

if (process.argv[2] === '--chat') {
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
            let res = await deepseek.invoke(message)
            console.log(res.content)
            message = messageAdd(message, res.content, 'assistant')
            ask()
        })
    }
    ask()

}


/**
 * @工具调用
 * 
 */
if (process.argv[2] === '--tool') {

}