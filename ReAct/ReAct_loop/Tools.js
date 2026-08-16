import z from 'zod'
import { getIncidentScenario } from './scenarios.js'
const serviceSchema = z.object({
	serviceName: z.string().min(1).describe('需要排查的服务名称')
})

/**
 * 将 Zod Schema 转换成模型 Tool Calls 使用的 JSON Schema。
 *
 * @param {z.ZodType} schema Zod 参数结构
 * @returns {object} JSON Schema
 */
function toToolParameters(schema) {
	const { $schema, ...parameters } = z.toJSONSchema(schema, {
		target: 'draft-7'
	})
	return parameters
}

/**
 * 提供给模型的只读故障排查工具。
 *
 * 本节没有提供重启和回滚工具，避免把人工确认和风险控制
 * 提前塞进最小 ReAct 案例。
 */
const tools = [
	{
		type: 'function',
		function: {
			name: 'get_service_health',
			description:
				'查询服务是否存活、实例健康数量和当前 5xx 错误率。开始排查线上服务异常时使用。',
			parameters: toToolParameters(serviceSchema)
		}
	},
	{
		type: 'function',
		function: {
			name: 'query_metrics',
			description:
				'查询故障时间段内的错误率、延迟、CPU、内存和数据库连接池使用率，用来确定异常从什么时候开始以及哪些指标同时变化。',
			parameters: toToolParameters(serviceSchema)
		}
	},
	{
		type: 'function',
		function: {
			name: 'query_logs',
			description:
				'查询故障时间段内的主要错误日志、首次出现时间、错误次数和服务版本。',
			parameters: toToolParameters(serviceSchema)
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_recent_deployments',
			description:
				'查询服务最近的版本发布时间和主要变更。只有指标或日志显示异常可能与版本变化有关时使用。',
			parameters: toToolParameters(serviceSchema)
		}
	},
	{
		type: 'function',
		function: {
			name: 'inspect_database_pool',
			description:
				'检查数据库连接池的活跃连接、等待请求和长时间运行的查询。只有指标或日志出现连接池异常时使用。',
			parameters: toToolParameters(serviceSchema)
		}
	}
]

/**
 * 为当前故障场景创建工具执行器。
 *
 * @param {string} scenarioName 故障场景名称
 * @returns {object} 工具定义、场景信息和执行函数
 */
export function createIncidentToolset(scenarioName) {
	const scenario = getIncidentScenario(scenarioName)
	const toolRegistry = {
		get_service_health: () => scenario.health,
		query_metrics: () => scenario.metrics,
		query_logs: () => scenario.logs,
		get_recent_deployments: () => scenario.deployments,
		inspect_database_pool: () => scenario.databasePool
	}

	/**
	 * 执行模型提出的一次 Action，并返回 Observation。
	 * 这里检查了工具存在性，参数合法性问题
	 * @param {object} toolCall DeepSeek 返回的 tool_call
	 * @returns {Promise<object>} 可回传给模型的 Observation
	 */
	async function executeToolCall(toolCall) {
		const toolName = toolCall.function.name
		const execute = toolRegistry[toolName]

		if (!execute) {
			return createError('TOOL_NOT_FOUND', `不存在工具 ${toolName}`)
		}

		let rawArguments

		try {
			rawArguments = JSON.parse(toolCall.function.arguments || '{}')
		} catch {
			return createError('INVALID_JSON_ARGUMENTS', '工具参数不是合法 JSON。')
		}

		const parsedArguments = serviceSchema.safeParse(rawArguments)

		if (!parsedArguments.success) {
			return createError(
				'INVALID_TOOL_ARGUMENTS',
				'工具参数没有通过校验。',
				parsedArguments.error.issues
			)
		}

		if (parsedArguments.data.serviceName !== scenario.serviceName) {
			return createError(
				'SERVICE_NOT_FOUND',
				`没有找到服务 ${parsedArguments.data.serviceName}`
			)
		}

		return {
			ok: true,
			source: toolName,
			data: execute()
		}
	}

	return {
		tools,
		scenario,
		executeToolCall
	}


}

/**
 * 创建统一的工具错误 Observation。
 *
 * @param {string} code 错误编码
 * @param {string} message 错误说明
 * @param {Array} [issues] 参数校验详情
 * @returns {object} 结构化错误
 */
function createError(code, message, issues) {
	return {
		ok: false,
		error: {
			code,
			message,
			...(issues ? { issues } : {})
		}
	}
}

