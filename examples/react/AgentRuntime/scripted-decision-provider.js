/**
 * 预设不同实验场景下，模型每一轮应该返回的决定。
 *
 * 这些场景用于测试 Agent Runtime 在正常完成、重复调用、
 * 长时间无进展和预算耗尽等情况下的处理逻辑。
 */
const SCENARIOS = {
	// 正常完成：依次查询监控、日志和发布记录，最后输出结论。
	complete: [
		toolCall('query_metrics'),
		toolCall('query_logs'),
		toolCall('get_recent_deployments'),
		finalAnswer(
			'最可能原因是 v2.4.1 的币种归一化变更引发 currency 字段读取失败。建议先停止继续发布，再由人工确认回滚或修复方案。'
		)
	],

	// 重复调用：连续执行完全相同的工具调用，用于测试重复动作检测。
	repeat: [
		toolCall('query_logs'),
		toolCall('query_logs'),
		toolCall('query_logs'),
		toolCall('query_logs')
	],

	// 无进展：虽然每次查询参数不同，但始终重复查询日志，
	// 用于测试 Agent 是否能够识别“持续执行但没有有效进展”。
	'no-progress': [
		toolCall('query_logs', { keyword: 'currency' }),
		toolCall('query_logs', { keyword: 'payment' }),
		toolCall('query_logs', { keyword: 'exception' }),
		toolCall('query_logs', { keyword: 'error' })
	],

	// 预算测试：只准备工具调用，不提供最终答案，
	// 用于测试 Agent 是否会因步骤、调用次数或 Token 超限而终止。
	budget: [
		toolCall('query_metrics'),
		toolCall('query_logs'),
		toolCall('get_recent_deployments')
	]
}

/**
 * 创建一个可以替代真实模型调用的确定性决策器。
 *
 * 决策器会按照指定实验场景中的顺序，逐轮返回预设的
 * Tool Call 或 Final Answer，并附带模拟的 Token 用量。
 *
 * @param {string} scenarioName 实验场景名称
 * @returns {Function} 与模型调用职责相同的异步决策函数
 */
function createDecisionProvider(scenarioName) {
	// 获取当前实验场景对应的预设决策序列。
	const decisions = SCENARIOS[scenarioName]

	if (!decisions) {
		throw new Error(`不存在实验 ${scenarioName}`)
	}

	// 记录当前应该返回第几轮决策。
	let index = 0

	return async function decideNextAction() {
		// 按照调用顺序取出本轮决策。
		const decision = decisions[index]
		index += 1

		// 如果调用轮数超过预设数量，说明实验数据准备不足。
		if (!decision) {
			throw new Error(`实验 ${scenarioName} 没有准备第 ${index} 轮决定。`)
		}

		return {
			...decision,

			// 模拟模型接口返回的 Token 使用情况。
			usage: {
				// 随着轮次增加，模拟上下文变长导致 Prompt Token 增加。
				promptTokens: 900 + index * 100,

				// 最终答案通常比工具调用参数消耗更多输出 Token。
				completionTokens: decision.type === 'final' ? 180 : 60
			}
		}
	}
}

/**
 * 创建一个工具调用类型的模型决策。
 *
 * 所有工具默认操作 payment-service，
 * extraArguments 可以补充或覆盖具体调用参数。
 *
 * @param {string} toolName 要调用的工具名称
 * @param {Object} [extraArguments={}] 额外的工具调用参数
 * @returns {Object} 标准化的 Tool Call 决策
 */
function toolCall(toolName, extraArguments = {}) {
	return {
		type: 'tool_call',
		action: {
			toolName,
			arguments: {
				serviceName: 'payment-service',
				...extraArguments
			}
		}
	}
}

/**
 * 创建一个最终回答类型的模型决策。
 *
 * @param {string} content 最终回答内容
 * @returns {Object} 标准化的 Final Answer 决策
 */
function finalAnswer(content) {
	return {
		type: 'final',
		content
	}
}

module.exports = {
	createDecisionProvider
}
