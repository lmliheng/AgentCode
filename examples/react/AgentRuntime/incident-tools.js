const { incident } = require('./incident-data')

const toolRegistry = {
	query_metrics: {
		evidenceSource: 'query_metrics',
		execute: () => incident.metrics
	},
	query_logs: {
		evidenceSource: 'query_logs',
		execute: () => incident.logs
	},
	get_recent_deployments: {
		evidenceSource: 'get_recent_deployments',
		execute: () => incident.deployments
	}
}

/**
 * 执行 Runtime 已经允许的一次 Action。
 *
 * @param {object} action 本轮 Action
 * @returns {Promise<object>} 带证据标识的 Observation
 */
async function executeTool(action) {
	const tool = toolRegistry[action.toolName]

	if (!tool) {
		throw new Error(`不存在工具 ${action.toolName}`)
	}

	if (action.arguments.serviceName !== incident.serviceName) {
		throw new Error(`没有找到服务 ${action.arguments.serviceName}`)
	}

	return {
		ok: true,
		source: tool.evidenceSource,
		evidenceKey: `${tool.evidenceSource}:${incident.serviceName}`,
		data: tool.execute()
	}
}

module.exports = {
	executeTool
}
