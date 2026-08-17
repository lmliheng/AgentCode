const { randomUUID } = require('node:crypto')

const DEFAULT_LIMITS = {
	maxSteps: 8,
	maxModelCalls: 8,
	maxToolCalls: 6,
	maxDurationMs: 10_000,
	maxTotalTokens: 12_000,
	maxSameAction: 2,
	maxNoProgress: 2
}

/**
 * 创建应用程序持有的 Agent Run State。
 *
 * Plan State 只是其中一部分。Runtime 还会记录整次运行的预算、
 * Action、Observation、证据和停止原因。
 *
 * @param {object} input 初始化参数
 * @returns {object} Agent Run State
 */
function createRunState({ goal, planState, limits = {} }) {
	// 返回了data的深拷贝，避免后续修改污染历史轨迹。
	return {
		// 本次 Agent 运行的唯一标识，用于日志追踪、状态查询和问题排查。
		runId: randomUUID(),

		// 当前 Agent 需要完成的用户目标。
		goal,

		// 当前运行状态；创建时默认为 running。
		status: 'running',

		// 本次运行停止的原因；运行期间暂时为空。
		stopReason: null,

		// 本次运行开始时的时间戳。
		startedAt: Date.now(),

		// 本次运行结束时的时间戳；尚未结束时为空。
		endedAt: null,

		// 保存任务计划状态。
		// 通过深拷贝避免 Agent Run State 与外部 planState 共享同一份引用。
		planState: cloneSerializableValue(planState),

		// 本次运行采用的执行预算和安全限制。
		limits: {
			// 先写入默认限制。
			...DEFAULT_LIMITS,

			// 再写入调用方传入的限制，覆盖同名的默认配置。
			...limits
		},

		// 记录本次运行已经产生的资源消耗。
		usage: {
			// 当前已经执行的 Agent 步骤数。
			steps: 0,

			// 当前已经调用模型的次数。
			modelCalls: 0,

			// 当前已经调用工具的次数。
			toolCalls: 0,

			// 模型输入部分累计消耗的 Token 数。
			promptTokens: 0,

			// 模型输出部分累计消耗的 Token 数。
			completionTokens: 0,

			// 输入 Token 和输出 Token 的累计总数。
			totalTokens: 0
		},

		// 记录 Agent 的任务进展，用于判断是否获得了新证据。
		progress: {
			// 已经收集到的证据唯一标识，避免重复计算相同证据。
			evidenceKeys: [],

			// 已经获取证据的数据来源，例如监控、日志或发布记录。
			evidenceSources: [],

			// 连续没有获得新证据的次数，用于检测无进展循环。
			consecutiveNoProgress: 0
		},

		// 保存模型每一轮产生的动作，例如工具调用或最终回答。
		actions: [],

		// 保存完整执行轨迹，用于调试、审计和故障分析。
		trace: [],

		// Agent 最终生成的回答；运行尚未完成时为空。
		finalAnswer: null
	}
}

/**
 * 在调用模型以前检查整次运行是否还有剩余预算。
 *
 * 该函数会检查运行状态、执行时长、步骤数、
 * 模型调用次数和 Token 消耗是否达到上限。
 *
 * @param {object} state Agent Run State
 * @returns {boolean} 是否可以继续调用模型
 */
function canCallModel(state) {
	// 如果 Agent 已经结束、失败或被停止，就不能继续调用模型。
	if (state.status !== 'running') {
		return false
	}

	/**
	 * @context budget的内容
	 */
	// 检查本次 Agent Run 的实际运行时间是否达到最大时长。
	if (Date.now() - state.startedAt >= state.limits.maxDurationMs) {
		// 将运行标记为预算耗尽，并记录触发的具体限制。
		stopRun(state, 'budget_exceeded', '达到最长执行时间。', {
			limit: 'maxDurationMs'
		})
		return false
	}


	/**
	 * @检查使用量超出就停止运行
	 */
	// 整理需要统一检查的计数型预算。
	// 每一项分别包含限制名称和当前已经使用的数量。
	const checks = [
		['maxSteps', state.usage.steps],
		['maxModelCalls', state.usage.modelCalls],
		['maxTotalTokens', state.usage.totalTokens]
	]
	// 依次检查步骤数、模型调用次数和 Token 消耗。
	for (const [limitName, used] of checks) {
		// 当前用量达到或超过限制时，立即停止本次运行。
		if (used >= state.limits[limitName]) {
			stopRun(state, 'budget_exceeded', `达到执行预算 ${limitName}。`, {
				// 记录具体触发了哪一项预算限制。
				limit: limitName
			})
			return false
		}
	}

	// 所有预算检查均通过，可以继续调用模型。
	return true
}

/**
 * 保存一次模型决定及其对应的 Token 用量。
 *
 * 该函数会更新 Agent Run State 中的步骤数、模型调用次数、
 * Token 累计用量和执行轨迹，并在 Token 超出预算时终止运行。
 *
 * @param {object} state Agent Run State
 * @param {object} decision 模型或决策器返回的本轮决定
 */
function recordModelDecision(state, decision) {
	// 读取本轮模型输入消耗的 Token。
	// 如果模型结果中没有提供 usage，则按 0 处理。
	const promptTokens = decision.usage?.promptTokens || 0
	// 读取本轮模型输出消耗的 Token。
	const completionTokens = decision.usage?.completionTokens || 0
	// 每次模型产生一个决定，都视为完成了一个 Agent 执行步骤。
	state.usage.steps += 1

	// 累加模型调用次数。
	state.usage.modelCalls += 1

	// 累加模型输入 Token。
	state.usage.promptTokens += promptTokens

	// 累加模型输出 Token。
	state.usage.completionTokens += completionTokens

	// 累加本次运行的 Token 总消耗。
	state.usage.totalTokens += promptTokens + completionTokens

	// 将本轮模型决定写入执行轨迹，
	// 方便后续进行调试、审计和运行过程分析。
	state.trace.push({
		// 当前轨迹记录的类型。
		type: 'model_decision',

		// 本次决定发生在第几个 Agent 步骤。
		step: state.usage.steps,

		// 模型决定的类型，例如 tool_call 或 final。
		decisionType: decision.type,

		// 保存本轮模型调用产生的 Token 用量。
		usage: {
			promptTokens,
			completionTokens
		}
	})

	// 模型调用前只能根据已有用量判断是否还有预算，
	// 因此本轮调用结束后，需要再次检查累计 Token 是否已经超限。
	if (state.usage.totalTokens > state.limits.maxTotalTokens) {
		// 将本次运行标记为预算超限，并记录触发的预算项。
		stopRun(state, 'budget_exceeded', '本轮模型调用后超过 Token 预算。', {
			limit: 'maxTotalTokens'
		})
	}
}

/**
 * 在工具执行以前检查工具调用预算和重复 Action。
 *
 * 只有当前运行仍在进行、工具调用次数未超限，
 * 并且相同 Action 的历史执行次数未达到上限时，才允许继续执行。
 *
 * @param {object} state Agent Run State
 * @param {object} action 当前准备执行的 Action
 * @returns {boolean} 是否允许执行当前 Action
 */
function canExecuteAction(state, action) {
	// 如果 Agent 已经完成、失败或被停止，就不能继续执行工具。
	if (state.status !== 'running') {
		return false
	}

	// 检查当前工具调用次数是否已经达到最大预算。
	if (state.usage.toolCalls >= state.limits.maxToolCalls) {
		// 将本次运行标记为预算耗尽，并记录触发的限制项。
		stopRun(state, 'budget_exceeded', '达到最大工具调用次数。', {
			limit: 'maxToolCalls'
		})
		return false
	}

	// 根据工具名称和调用参数生成 Action 指纹，
	// 用于判断当前 Action 是否与历史 Action 完全相同。
	const fingerprint = createActionFingerprint(action)

	// 统计当前运行中，相同 Action 已经出现过多少次。
	const sameActionCount = state.actions.filter(
		(item) => item.fingerprint === fingerprint
	).length

	// 如果相同 Action 的历史执行次数已经达到上限，
	// 说明 Agent 可能陷入了重复调用循环。
	if (sameActionCount >= state.limits.maxSameAction) {
		stopRun(state, 'repeated_action', '相同 Action 已经达到允许执行次数。', {
			// 保存触发重复检测的具体 Action。
			action
		})
		return false
	}

	// 当前 Action 通过检查后，将其保存到动作历史中。
	state.actions.push({
		// 记录该 Action 对应的 Agent 执行步骤。
		step: state.usage.steps,

		// 保存 Action 指纹，方便后续进行重复检测。
		fingerprint,

		// 深拷贝 Action，避免后续修改原对象影响历史记录。
		action: cloneSerializableValue(action)
	})

	// 同时将当前 Action 写入完整执行轨迹，
	// 用于调试、审计和运行过程分析。
	state.trace.push({
		type: 'action',
		step: state.usage.steps,
		action: cloneSerializableValue(action)
	})

	// 所有检查均已通过，允许 Runtime 执行当前工具调用。
	return true
}

/**
 * 保存工具返回的 Observation，并判断任务是否获得了新的进展。
 *
 * 该函数会更新工具调用次数、证据记录、连续无进展次数、
 * Plan State 和执行轨迹，并根据无进展规则决定是否终止运行。
 *
 * @param {object} state Agent Run State
 * @param {object} observation 工具返回的 Observation
 * @returns {boolean} 本轮是否获得了新的证据
 */
function recordObservation(state, observation) {
	// 每获得一次工具返回结果，就累加一次工具调用次数。
	state.usage.toolCalls += 1

	// 根据 evidenceKey 判断当前证据是否已经出现过。
	// 如果证据标识不在历史记录中，就认为本轮获得了新证据。
	const hasNewEvidence = !state.progress.evidenceKeys.includes(
		observation.evidenceKey
	)

	if (hasNewEvidence) {
		// 保存新证据的唯一标识，避免后续重复计算相同证据。
		state.progress.evidenceKeys.push(observation.evidenceKey)

		// 记录证据来源，例如监控、日志或发布记录。
		state.progress.evidenceSources.push(observation.source)

		// 本轮获得了新进展，因此清空连续无进展计数。
		state.progress.consecutiveNoProgress = 0

		// 根据证据来源，将对应的计划步骤标记为已完成。
		markPlanStepCompleted(state.planState, observation.source)
	} else {
		// 没有获得新证据时，累加连续无进展次数。
		state.progress.consecutiveNoProgress += 1
	}

	// 将本轮工具返回结果写入完整执行轨迹。
	state.trace.push({
		// 当前轨迹记录的类型。
		type: 'observation',

		// 当前 Observation 对应的 Agent 执行步骤。
		step: state.usage.steps,

		// 当前证据来自哪个工具或数据源。
		source: observation.source,

		// 当前证据的唯一标识。
		evidenceKey: observation.evidenceKey,

		// 标记本轮是否获得了新的证据。
		hasNewEvidence,

		// 保存工具返回结果的摘要，方便调试和审计。
		summary: observation.data.summary
	})

	// 如果连续无进展次数达到上限，
	// 说明 Agent 可能陷入了无法推进任务的循环。
	if (state.progress.consecutiveNoProgress >= state.limits.maxNoProgress) {
		stopRun(state, 'no_progress', '连续多次工具调用没有获得新的证据。', {
			// 记录终止时的连续无进展次数。
			consecutiveNoProgress: state.progress.consecutiveNoProgress
		})

		return hasNewEvidence
	}

	// 如果所有计划步骤都已经完成，
	// 将 Plan State 标记为可以生成最终答案。
	if (hasCompletedPlan(state.planState)) {
		state.planState.status = 'ready_to_finish'
	}

	// 返回本轮工具调用是否带来了新的有效证据。
	return hasNewEvidence
}

/**
 * 接收模型生成的最终回答，并尝试完成本次 Agent Run。
 *
 * 在正式结束运行以前，会先检查 Plan State 中定义的任务条件
 * 是否已经全部完成，避免模型过早输出最终答案。
 *
 * @param {object} state Agent Run State
 * @param {string} content 模型生成的最终回答
 */
function completeRun(state, content) {
	// 检查当前任务计划是否已经满足全部完成条件。
	if (!hasCompletedPlan(state.planState)) {
		// 如果计划中仍然存在未完成步骤或条件，
		// 说明模型过早尝试结束任务，将本次运行标记为失败。
		stopRun(
			state,
			'failed',
			'模型准备结束任务，但 Plan State 中仍有未完成条件。'
		)
		return
	}

	// 保存模型生成的最终回答。
	state.finalAnswer = content

	// 将本次 Agent Run 标记为已完成，并记录终止原因。
	stopRun(state, 'completed', '任务完成。')
}

/**
 * 统一结束一次 Agent Run。
 *
 * @param {object} state Agent Run State
 * @param {string} code 停止编码
 * @param {string} message 停止说明
 * @param {object} [details] 补充信息
 */
function stopRun(state, code, message, details = {}) {
	if (state.status !== 'running') {
		return
	}

	state.status = code === 'completed' ? 'completed' : 'stopped'
	state.stopReason = {
		code,
		message,
		...details
	}
	state.endedAt = Date.now()
	state.trace.push({
		type: 'stop',
		step: state.usage.steps,
		reason: cloneSerializableValue(state.stopReason)
	})
}

/**
 * 根据证据来源，将对应的计划步骤标记为已完成。
 *
 * @param {object} planState 当前任务的 Plan State
 * @param {string} evidenceSource 本次获得证据的来源
 */
function markPlanStepCompleted(planState, evidenceSource) {
	// 查找证据来源匹配，并且尚未完成的计划步骤。
	const step = planState.steps.find(
		(item) =>
			item.requiredEvidenceSource === evidenceSource &&
			item.status !== 'completed'
	)

	// 如果找到对应步骤，就将其状态更新为 completed。
	if (step) {
		step.status = 'completed'
	}
}

/**
 * 判断 Plan State 中的所有计划步骤是否都已经完成。
 *
 * @param {object} planState 当前任务的 Plan State
 * @returns {boolean} 所有步骤是否都处于 completed 状态
 */
function hasCompletedPlan(planState) {
	// 只有每一个计划步骤都已完成，才认为整个任务计划已经完成。
	return planState.steps.every((step) => step.status === 'completed')
}

/**
 * 为 Action 生成稳定且可比较的唯一指纹。
 *
 * 指纹由工具名称和经过稳定序列化的调用参数组成，
 * 用于判断两次 Action 是否完全相同。
 *
 * @param {object} action 当前 Action
 * @returns {string} Action 对应的指纹
 */
function createActionFingerprint(action) {
	// 将工具名称与参数序列化结果组合起来。
	// stableStringify 可以保证对象属性顺序不同时仍然生成相同字符串。
	return `${action.toolName}:${stableStringify(action.arguments)}`
}

function stableStringify(value) {
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(',')}]`
	}

	if (value && typeof value === 'object') {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
			.join(',')}}`
	}

	return JSON.stringify(value)
}

/**
 * 复制只包含 JSON 数据的状态对象，避免后续修改污染历史轨迹。
 *
 * @param {unknown} value 可序列化数据
 * @returns {unknown} 深拷贝后的数据
 */
function cloneSerializableValue(value) {
	return JSON.parse(JSON.stringify(value))
}

module.exports = {
	DEFAULT_LIMITS,
	createRunState,
	canCallModel,
	recordModelDecision,
	canExecuteAction,
	recordObservation,
	completeRun,
	stopRun
}
