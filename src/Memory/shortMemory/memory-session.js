import { MemorySaver } from '@langchain/langgraph'
import {
	createMemoryAgent,
	createThreadConfig,
	printState
} from './session.js'

/**
 * 在同一个 Node.js 进程里验证：
 * 1. 相同 Thread 能够接续已有 State；
 * 2. 不同 Thread 相互隔离；
 * 3. thread_id 不能替代用户权限校验。
 */
async function main() {
	const checkpointer = new MemorySaver()
	const agent = createMemoryAgent(checkpointer)

	const userOneConfig = createThreadConfig(
		'user-1001',
		'support-user-1001'
	)

	await agent.invoke(
		{
			messages: [
				{
					role: 'user',
					content: '订单 A1024 的退款金额是 3000 元，请先记住。'
				}
			]
		},
		userOneConfig
	)

	const continuedState = await agent.invoke(
		{
			messages: [
				{
					role: 'user',
					content: '刚才说的是哪个订单，退款金额是多少？'
				}
			]
		},
		userOneConfig
	)

	printState('同一个 Thread：第二轮接续第一轮 State', continuedState)

	const userTwoConfig = createThreadConfig(
		'user-1002',
		'support-user-1002'
	)

	const isolatedState = await agent.invoke(
		{
			messages: [
				{
					role: 'user',
					content: '刚才说的是哪个订单，退款金额是多少？'
				}
			]
		},
		userTwoConfig
	)

	printState('不同 Thread：没有继承其他会话消息', isolatedState)

	console.log('\n========== 越权访问验证 ==========')

	try {
		createThreadConfig('user-1002', 'support-user-1001')
	} catch (error) {
		console.log(error.message)
	}
}

main().catch((error) => {
	console.error(error)
	process.exitCode = 1
})

