import { ChatDeepSeek } from '@langchain/deepseek'
import { createAgent } from 'langchain'

/**
 * 课程演示使用的会话归属关系。
 * 真实项目应该从数据库读取，并在每次请求进入 Agent 以前校验。
 */
const THREAD_OWNERS = new Map([
	['support-user-1001', 'user-1001'],
	['support-user-1002', 'user-1002'],
	['support-postgres-1001', 'user-1001']
])

/** 创建本章统一使用的 Chat Model。 */
export function createModel() {
	if (!process.env.DEEPSEEK_API_KEY) {
		throw new Error('缺少 DEEPSEEK_API_KEY，请先在 .env 中完成配置。')
	}

	return new ChatDeepSeek({
		model: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
		temperature: 0,
		maxRetries: 2
	})
}

/** 使用指定 Checkpointer 创建同一套知识客服 Agent。 */
export function createMemoryAgent(checkpointer, model = createModel()) {
	return createAgent({
		model,
		tools: [],
		checkpointer,
		systemPrompt: `你是企业售后知识客服。
只能根据当前会话中已经出现的信息回答，不得猜测订单数据。
回答尽量简洁；缺少信息时要明确说明。`
	})
}

/**
 * 校验当前用户是否拥有指定 Thread，并生成 Agent 调用配置。
 * thread_id 只负责定位会话，不能替代身份认证和权限校验。
 */
export function createThreadConfig(userId, threadId) {
	const ownerId = THREAD_OWNERS.get(threadId)

	if (!ownerId) {
		throw new Error(`Thread ${threadId} 不存在。`)
	}

	if (ownerId !== userId) {
		throw new Error(`用户 ${userId} 无权访问 Thread ${threadId}。`)
	}

	return {
		configurable: { thread_id: threadId },
		context: { userId }
	}
}

/** 把 Message 内容整理成便于终端观察的短文本。 */
function messageText(message) {
	const content =
		typeof message.content === 'string'
			? message.content
			: JSON.stringify(message.content)

	return content.replaceAll(/\s+/g, ' ').slice(0, 100)
}

/** 打印当前 State 中真实保存的消息，而不是只打印模型最终回答。 */
export function printState(label, state) {
	console.log(`\n========== ${label} ==========`)
	console.log(`消息数量：${state.messages.length}`)

	console.table(
		state.messages.map((message, index) => ({
			序号: index + 1,
			类型: message.getType(),
			内容: messageText(message)
		}))
	)
}
