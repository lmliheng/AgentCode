const {
	canCallModel,
	recordModelDecision,
	canExecuteAction,
	recordObservation,
	completeRun,
	stopRun
} = require('./runtime-state')

/**
 * 驱动一次完整的 Agent Run。
 *
 * Runtime 不负责生成 Action，也不负责实现具体工具。
 * 它负责在模型和工具之外维护运行状态、执行预算与终止规则。
 *
 * @param {object} input 运行参数
 * @param {object} input.state Agent Run State
 * @param {Function} input.decideNextAction 模型决策入口
 * @param {Function} input.executeTool 工具执行入口
 * @returns {Promise<object>} 运行结束后的 Agent Run State
 */
async function runAgent({ state, decideNextAction, executeTool }) {
	// 只要运行状态仍然是 running，就继续执行 Agent 循环。
	while (state.status === 'running') {
		// 在调用模型前检查模型调用次数、Token、运行时长等预算。
		// 如果已经达到限制，检查函数会负责终止运行。
		if (!canCallModel(state)) {
			break
		}

		try {
			// 调用模型决策入口，让模型根据当前状态决定下一步：
			// 返回工具调用 Action，或者直接返回最终答案。
			const decision = await decideNextAction({ state })

			// 记录本轮模型调用、Token 消耗、步骤数和决策结果。
			recordModelDecision(state, decision)

			// 记录模型决策时，Runtime 可能因为 Token 超限等原因停止运行。
			if (state.status !== 'running') {
				break
			}

			// 如果模型认为任务已经完成，就保存最终答案并结束运行。
			if (decision.type === 'final') {
				console.log(`\n第 ${state.usage.steps} 轮：模型准备结束任务`)
				completeRun(state, decision.content)
				break
			}

			// 输出模型本轮准备执行的工具调用。
			console.log(`\n第 ${state.usage.steps} 轮 Action：`)
			console.dir(decision.action, { depth: null })

			// 在执行工具前检查工具调用预算、重复动作等终止规则。
			// 如果当前 Action 不允许继续执行，则直接退出循环。
			if (!canExecuteAction(state, decision.action)) {
				break
			}

			// 执行模型选择的工具，并获得工具返回的 Observation。
			const observation = await executeTool(decision.action)

			// 将工具结果写入运行状态，并判断本轮是否获得了新的有效证据。
			const hasNewEvidence = recordObservation(state, observation)

			// 输出工具返回结果和进展判断。
			console.log('Observation：')
			console.log(observation.data.summary)
			console.log(`是否获得新证据：${hasNewEvidence ? '是' : '否'}`)
		} catch (error) {
			// 模型调用、工具执行或状态更新出现异常时，
			// 将本次运行标记为失败，并记录具体错误原因。
			stopRun(
				state,
				'failed',
				error instanceof Error ? error.message : String(error)
			)
		}
	}

	// 返回终止后的完整 Agent Run State。
	return state
}

module.exports = {
	runAgent
}
