const API_URL =
	process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions'

export const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'

/**
 * 调用 DeepSeek Chat Completions。
 *
 * Host 会把当前 messages 和由 MCP Tools 转换出的工具说明一起发送给模型。
 */
export async function callDeepSeek({ messages, tools }) {
	if (!process.env.DEEPSEEK_API_KEY) {
		throw new Error('缺少 DEEPSEEK_API_KEY，请先在 .env 中完成配置。')
	}

	const startedAt = Date.now()
	// 调用 DeepSeek API
	const response = await fetch(API_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: MODEL,
			messages,
			tools,
			tool_choice: 'auto',
			thinking: {
				type: 'disabled'
			},
			temperature: 0.1
		})
	})

	// 解析 DeepSeek API 返回结果
	const data = await response.json()

	if (!response.ok) {
		throw new Error(
			`DeepSeek 调用失败：${response.status} ${JSON.stringify(data)}`
		)
	}

	// DeepSeek 返回的消息可能包含多条候选结果，通常取第一条即可。
	const choice = data.choices?.[0]
	if (!choice?.message) {
		throw new Error(`DeepSeek 没有返回有效消息：${JSON.stringify(data)}`)
	}

	return {
		message: choice.message,
		finishReason: choice.finish_reason,
		latencyMs: Date.now() - startedAt,
		usage: data.usage
	}
}
