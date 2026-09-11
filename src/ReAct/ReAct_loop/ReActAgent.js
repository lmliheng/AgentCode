
import { callDeepSeek_Toolcalling } from '../../LLMclients/deepseek_client.js'
/**
 * 当前最小案例最多执行 8 次模型调用。
 *
 * 这里只把它当作防止无限循环的最后保护。
 * 完整的执行预算和终止条件会在后续小节实现。
 */
const MAX_STEPS = 8

const SYSTEM_PROMPT = `你是一个线上故障排查 Agent。

你的任务是根据工具返回的真实数据，找出最可能的故障原因并给出处理建议。

执行规则：
1. 不能猜测监控、日志、数据库或发布信息，所有事实必须来自工具结果。
2. 每一轮只调用一个工具，读取 Observation 后再决定下一步。
3. 在生成最终结论前，至少检查服务状态、监控指标和错误日志。
4. 完成上面三项检查以后，只能根据 Observation 选择一条验证路线：
   - 日志显示错误与服务版本或代码变更有关：查询最近发布记录。
   - 指标或日志显示数据库连接池异常：检查数据库连接池。
5. 完成对应路线的验证以后直接生成最终回答，不要为了排除所有可能性再调用另一条路线。
6. 不要重复相同调用。
7. 最终回答必须包含：最可能原因、关键证据、建议动作和暂时无法确认的信息。

当前工具都是只读工具。你只能提出处理建议，不能声称已经重启服务或者回滚版本。`

/**
 * 运行最小 ReAct Agent。
 *
 * 每一步只观察应用程序能够拿到的数据：
 *
 * Action：模型提出的 tool_call
 * Observation：工具执行后返回的真实结果
 *
 * @param {object} input 运行参数
 * @param {string} input.goal 用户目标
 * @param {Array} input.tools 模型可用工具
 * @param {Function} input.executeToolCall 工具执行函数
 * @returns {Promise<object>} 最终回答和执行轨迹
 */
export async function runReactAgent({ goal, tools, executeToolCall }) {
    const messages = [
        {
            role: 'system',
            content: SYSTEM_PROMPT
        },
        {
            role: 'user',
            content: goal
        }
    ]

    /**
     * trajectory 只记录可以被应用程序观察的执行过程。
     */
    const trajectory = []
    console.log(`目标：${goal}`)

    for (let step = 1; step <= MAX_STEPS; step += 1) {
        console.log(`\n================ Step ${step} ================`)

        const result = await callDeepSeek_Toolcalling(
            messages,
            tools
        )

        const toolCalls = result.message.tool_calls || []

        console.log(
            `模型调用：${result.latencyMs}ms，finish_reason=${result.finishReason}`
        )

        /**
         * 没有 tool_calls，表示模型认为已经可以生成最终回答。
         */
        if (toolCalls.length === 0) {
            console.log('\nFinal Answer：')
            console.log(result.message.content)
            printTrajectory(trajectory)
            return {
                finalAnswer: result.message.content,
                trajectory
            }
        }

        /**
         * 完整保留模型返回的 assistant 消息。
         *
         * 下一条 role=tool 消息需要通过 tool_call_id
         * 与这里的 tool_calls 建立对应关系。
         */
        messages.push({
            role: 'assistant',
            content: result.message.content ?? null,
            tool_calls: toolCalls
        })

        for (const toolCall of toolCalls) {
            const action = {
                toolName: toolCall.function.name,
                arguments: parseArgumentsForDisplay(toolCall.function.arguments)
            }

            console.log('\nAction：')
            console.dir(action, { depth: null })
            const observation = await executeToolCall(toolCall)
            console.log('\nObservation：')
            console.dir(observation, { depth: null })
            trajectory.push({
                step,
                action,
                observation
            })

            /**
             * 将真实 Observation 放回 messages。
             *
             * 下一轮模型调用时，模型会看到这份结果，
             * 再决定下一个 Action。
             */
            messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(observation)
            })
        }
    }

    throw new Error(`达到最大执行步数 ${MAX_STEPS}，Agent 仍然没有生成最终回答。`)
}

/**
 * 解析工具参数仅用于终端展示。
 *
 * 真正执行时仍会在 incident-tools.js 中重新解析和校验，
 * 不能因为这里解析成功就跳过工具参数校验。
 *
 * @param {string} rawArguments 模型返回的 JSON 字符串
 * @returns {object|string} 展示用参数
 */
function parseArgumentsForDisplay(rawArguments) {
    try {
        return JSON.parse(rawArguments || '{}')
    } catch {
        return rawArguments
    }
}

/**
 * 打印本次任务经过的 Action 路径。
 *
 * @param {Array} trajectory 执行轨迹
 */
function printTrajectory(trajectory) {
    console.log('\n执行路径：')
    for (const item of trajectory) {
        console.log(`${item.step}. ${item.action.toolName}`)
    }
}

