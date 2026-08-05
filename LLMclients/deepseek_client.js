
export async function callDeepSeek(messages) {
    const API_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions'
    const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
    // 调用模型前先检查 API Key，避免发送无效请求。
    if (!process.env.DEEPSEEK_API_KEY) {
        throw new Error('缺少 DEEPSEEK_API_KEY，请先在 .env 中完成配置。')
    }
    // 记录请求开始时间，用于统计模型接口耗时。
    const startedAt = Date.now()
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: MODEL,
            // 当前完整对话上下文。
            messages,
            // // 将可用工具说明发送给模型。
            // tools,
            // /**
            //  * 由模型自动决定：
            //  * - 直接生成文本回答
            //  * - 调用某个工具
            //  */
            // tool_choice: 'auto',

            thinking: {
                type: 'enabled'
            },

            // 使用较低温度，减少工具选择和参数生成的随机性。
            temperature: 0.1
        })
    })

    /**
     * 无论 HTTP 状态码是否成功，都先解析响应体。
     *
     * 这样接口失败时，也可以将服务端返回的错误信息
     * 一起放入异常中，方便定位问题。
     */
    const data = await response.json()

    if (!response.ok) {
        throw new Error(
            `DeepSeek 调用失败：${response.status} ${JSON.stringify(data)}`
        )
    }

    // Chat Completions 接口的主要结果位于 choices 数组的第一项。
    const choice = data.choices?.[0]
    // 防止接口返回成功状态，但响应结构中没有有效模型消息。
    if (!choice?.message) {
        throw new Error(`DeepSeek 没有返回有效消息：${JSON.stringify(data)}`)
    }

    return {
        /**
         * 模型本轮返回的完整消息。
         *
         * 可能包含：
         * - content：普通文本回答
         * - tool_calls：模型提出的工具调用请求
         */
        message: choice.message,
        /**
         * 模型停止生成的原因。
         *
         * 常见值包括：
         * - stop：模型已经生成最终回答
         * - tool_calls：模型请求调用工具
         * - length：达到最大输出长度
         */
        finishReason: choice.finish_reason,
        // 本次模型接口调用的总耗时，单位为毫秒。
        latencyMs: Date.now() - startedAt,
        // 输入、输出以及总 Token 数量等统计信息。
        usage: data.usage
    }
}


export async function getDeepseekBalance() {

    const token = process.env.DEEPSEEK_API_KEY
    if (!token) {
        throw new Error('DEEPSEEK_API_KEY 未设置，检查 .env 和 dotenv 加载顺序')
    }

    try {
        const response = await fetch('https://api.deepseek.com/user/balance', {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
            }
        })
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
        }

        // console.log(response)

        const data = await response.json()
        return data

    } catch (error) {
        console.error('请求失败:', error.message)
    }
}


// module.exports = {
//     MODEL,
//     callDeepSeek,
//     getDeepseekBalance
// }