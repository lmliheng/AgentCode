import { ChatDeepSeek } from "@langchain/deepseek"
import { messageAdd, messageCreate } from '../../../LLMclients/message_tools.js'
import { HumanMessage, AIMessage, SystemMessage, tool, ToolMessage } from "langchain"
import fs_mcp from '@lmliheng/filesystem-mcp'
import * as readline from 'readline'
import z from "zod"

/**
 * @LLM对象
 * 自动读取环境变量DEEPSEEK_API_AKI
 * let deepseek = new ChatDeepSeek({
 *    model: 'deepseek-v4-flash',
 * })
 */
export function createModel(
    option = {
        model: 'deepseek-v4-flash',
    }
) {
    return new ChatDeepSeek(option)
}

/**
 * @单多轮对话
 * 可以看到invoke方法支持generate和chat两种对话格式
 * 
 */
if (process.argv[2] === '--generate') {
    let deepseek = createModel()
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
    let deepseek = createModel()
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
 * tool 属于langchain用于创建工具
 * model.bind_tools[tool1，tool2]
 */
if (process.argv[2] === '--tool') {

    let deepseek = createModel()
    /**
     * @注册工具
     */
    const dirRead = tool(
        async ({ dirPath }) => {
            let dir_content = await fs_mcp.dirRead(dirPath)
            return JSON.stringify({
                dirPath,
                dir_content
            })
        },
        {
            name: 'read_dir',
            description: '读取目录下的文件和目录信息',
            schema: z.object({
                dirPath: z.string().describe('windows系统目录路径，例如C:\\dir\\example')
            })
        }
    )
    const diskName = tool(
        async () => {
            let res = await fs_mcp.disk_name()
            return {
                disk_name: res
            }
        },
        {
            name: 'read_disk_name',
            description: '读取windows系统磁盘名如C,D盘',
        }
    )

    let deepseek_withTools = deepseek.bindTools([dirRead, diskName])
    // tool calling
    let q = '帮我检查电脑磁盘名 并检查C盘下文件和目录'

    let message = [new HumanMessage(q)]

    for (let i = 0; i < 10; i++) {
        let response = await deepseek_withTools.invoke(message)
        console.log(`第${i + 1}次回答`, response.content)
        let tool_calls = response.tool_calls
        if (tool_calls && tool_calls.length > 0) {
            message.push(new AIMessage({
                content: response.content,
                tool_calls: response.tool_calls
            }))
            /**
                * @模型调用阶段
                * 在模型调用场景下，必须用 ToolMessage 把结果包起来并带上 tool_call_id
                * agent场景呢
                * 
                * 
                */
            for (const call of tool_calls) {
                let result

                /**
                 *  "tool_calls": [
                 * {
                 * "name": "read_disk_name",
                 * "args": {
                 * "input": ""
                 * },
                 * "type": "tool_call",
                 * "id": "call_00_LbBH6g7SZLOYSTELGx5y4698"
                 * }]
                 */

                switch (call.name) {
                    case 'read_disk_name':
                        result = await diskName.invoke()
                        break
                    case 'read_dir':
                        result = await dirRead.invoke(call.args)
                        break
                    default:
                        console.error('没有该工具')
                }


                message.push(new ToolMessage({
                    content: typeof result === 'string' ? result : JSON.stringify(result),
                    tool_call_id: call.id
                }));
            }

        } else {

            break
        }


    }


}
/**
 * @HumanMessage, AIMessage, SystemMessage,ToolMessage
 */
if (process.argv[2] === '--message') {
    let deepseek = createModel()
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
                message = [new HumanMessage(answer)]
            } else {
                message.push(new HumanMessage(answer))
            }
            /**
             * @返回AImessage类型
             */
            let res = await deepseek.invoke(message)
            console.log(res.content)
            message.push(res)
            console.log(message)
            ask()
        })
    }
    ask()
}
