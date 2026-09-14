/**
 * 
 * Tool Calling / Function Calling
 * 
 * Tool定义在deepseek_client.ts下
 * 
 * 本质:
 * 告诉模型我有哪些功能Tools，resource，prompts，模型返回它需要调用的（在response.message.tool_calls数组里）
 * 我本地来调用后，加入到context，下一次循环继续，直到模型不再需要调用，也就是tool_calls数组为空
 */

import { type ToolDefinition, type ToolCall, callDeepSeek, type AssistantMessage } from '../../LLM/deepseek_client.js'
import { UserMessageCreate, MessageAdd, SystemMessageCreate, MessageCombine } from '../../LLM/message_tools.js'
import { Tools } from './tool.js'


let MaxLoop = 10
let message = SystemMessageCreate('只允许调用我给你的工具')
MessageAdd(message, '检查长沙的天气', 'user')
for (let i = 0; i < MaxLoop; i++) {
    let res = await callDeepSeek(message, { tools: Tools.getDefinitions() })
    console.log(i, ":", res, res.message.tool_calls)
    if (res.finishReason == 'stop' || res.finishReason == 'length' || res.message.tool_calls?.length == 0) {
        break
    }
    MessageCombine(message, res.message)
    for (let tool_call of res.message.tool_calls!) {
        let tool_call_res = await Tools.executeToolCall(tool_call)
        MessageCombine(message, tool_call_res)
    }
}



