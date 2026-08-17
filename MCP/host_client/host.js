/**
 * @这里实现了host和client
 * server由高德 MCP server提供，使用streamableHTTP
 */

import { callDeepSeek } from './deepseek-client.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { messageCreate } from './message_tools.js'

/**
 * @重要函数
 * 将MCP server/client的格式转化为Toolcalling
 */
function toModelTools(mcpTools) {
    return mcpTools.map((tool) => {
        /**
         * 部分 MCP Tool 的 inputSchema 中可能包含 $schema 字段，
         * 但模型接口通常只需要 type、properties、required 等内容。
         */
        const { $schema, ...parameters } = tool.inputSchema
        return {
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description || '',
                parameters
            }
        }
    })
}

async function hostrun() {
    let client = new Client({
        name: '高德地图工具',
        version: '1.0.1'
    })
    const transport = new StreamableHTTPClientTransport(new URL(process.env.AMAP_MCP_URL))
    await client.connect(transport)
    let { tools } = await client.listTools()
    let modelTools = toModelTools(tools)
    // check server Tools
    console.log(tools)

    /**
     * @调用DS进行高德MCP调用
     * tool calling 等待模型返回tool_calls
     * 
     * prompts:'你查看这个MCP，返回一个md格式的表格，说明高德暴露了哪些功能，并在表格里说说可以通过这些功能做什么'
     * 
     */
    let messages = messageCreate('你查看这个MCP，返回一个md格式的表格，说明高德暴露了哪些功能，并在表格里说说可以通过这些功能做什么')
    for (let round = 1; round <= 20; round += 1) {
        console.log(`\n--- 第 ${round} 轮模型调用 ---`)
        const modelResult = await callDeepSeek({
            messages,
            tools: modelTools
        })
        const toolCalls = modelResult.message.tool_calls || []
        // console.log(toolCalls)
        /**
         * 模型没有返回 tool_calls，表示当前已经不需要继续使用工具，直接结束对话
         */
        if (toolCalls.length === 0) {
            console.log('\n最终回答：')
            console.log(modelResult.message.content)
            return
        }
        console.log(modelResult.message.content)
        messages.push({
            role: 'assistant',
            content: modelResult.message.content ?? null,
            tool_calls: toolCalls
        })
        // 执行toolCall并推入messages
        for (const toolCall of toolCalls) {

            const args = JSON.parse(toolCall.function.arguments)
            // 调用 MCP 工具
            const result = await client.callTool({
                name: toolCall.function.name,
                arguments: args
            })
            // console.log(result)
            messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(result)
            })
        }
    }

}

await hostrun()