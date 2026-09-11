/**
 * 本地故障数据模拟器。就写了两个场景
 * 新版本发布导致支付接口异常 和  数据库连接池耗尽导致支付接口异常
 *
 * 当前小节只研究 Agent 怎样根据 Observation 选择下一步，
 * 因此不用准备真实监控、日志和发布平台。
 */
const incidentScenarios = {
	'release-regression': {
		label: '新版本发布导致支付接口异常',
		serviceName: 'payment-service',
		health: {
			observedAt: '2026-07-27T15:16:00+08:00',
			status: 'degraded',
			processUp: true,
			instances: {
				healthy: 6,
				total: 6
			},
			http5xxRate: 31.8,
			summary: '所有实例仍然存活，但支付接口的 5xx 错误率明显升高。'
		},
		metrics: {
			window: '2026-07-27 15:00:00 - 15:20:00',
			firstAnomalyAt: '2026-07-27T15:10:06+08:00',
			http5xxRate: {
				baseline: 0.4,
				current: 31.8
			},
			p95LatencyMs: {
				baseline: 180,
				current: 2140
			},
			cpuUsagePercent: 43,
			memoryUsagePercent: 58,
			databasePoolUsagePercent: 46,
			summary:
				'5xx 和响应延迟在 15:10 同时升高，CPU、内存和数据库连接池仍处于正常范围。'
		},
		logs: {
			window: '2026-07-27 15:08:00 - 15:18:00',
			totalErrorCount: 731,
			topErrors: [
				{
					code: 'PAYMENT_CURRENCY_UNDEFINED',
					message:
						"TypeError: Cannot read properties of undefined (reading 'currency')",
					firstSeenAt: '2026-07-27T15:10:08+08:00',
					count: 689,
					version: 'v2.4.1'
				}
			],
			summary:
				'主要错误来自 currency 字段读取失败，首次出现时间为 15:10，错误实例运行版本为 v2.4.1。'
		},
		deployments: {
			items: [
				{
					version: 'v2.4.1',
					startedAt: '2026-07-27T15:05:00+08:00',
					completedAt: '2026-07-27T15:09:42+08:00',
					status: 'completed',
					changes: ['重构支付请求中的币种归一化逻辑']
				},
				{
					version: 'v2.4.0',
					startedAt: '2026-07-24T10:30:00+08:00',
					completedAt: '2026-07-24T10:35:00+08:00',
					status: 'completed',
					changes: ['更新支付渠道超时配置']
				}
			],
			summary: 'v2.4.1 在异常出现前约 20 秒完成发布，并修改了币种归一化逻辑。'
		},
		databasePool: {
			activeConnections: 46,
			maxConnections: 100,
			waitingRequests: 0,
			acquireLatencyP95Ms: 12,
			summary: '数据库连接池状态正常，没有连接耗尽迹象。'
		}
	},


	'database-pool': {
		label: '数据库连接池耗尽导致支付接口异常',
		serviceName: 'payment-service',
		health: {
			observedAt: '2026-07-27T15:16:00+08:00',
			status: 'degraded',
			processUp: true,
			instances: {
				healthy: 6,
				total: 6
			},
			http5xxRate: 26.4,
			summary: '所有实例仍然存活，但支付接口持续返回 5xx。'
		},
		metrics: {
			window: '2026-07-27 15:00:00 - 15:20:00',
			firstAnomalyAt: '2026-07-27T15:10:11+08:00',
			http5xxRate: {
				baseline: 0.5,
				current: 26.4
			},
			p95LatencyMs: {
				baseline: 190,
				current: 4860
			},
			cpuUsagePercent: 39,
			memoryUsagePercent: 61,
			databasePoolUsagePercent: 100,
			summary:
				'数据库连接池使用率达到 100%，同时出现大量请求等待，CPU 和内存没有明显异常。'
		},
		logs: {
			window: '2026-07-27 15:08:00 - 15:18:00',
			totalErrorCount: 604,
			topErrors: [
				{
					code: 'DB_POOL_ACQUIRE_TIMEOUT',
					message: 'Timeout acquiring database connection after 3000ms',
					firstSeenAt: '2026-07-27T15:10:12+08:00',
					count: 577,
					version: 'v2.3.8'
				}
			],
			summary:
				'主要错误是获取数据库连接超时，没有出现空指针、版本兼容或网络连接错误。'
		},
		deployments: {
			items: [
				{
					version: 'v2.3.8',
					startedAt: '2026-07-25T11:00:00+08:00',
					completedAt: '2026-07-25T11:06:00+08:00',
					status: 'completed',
					changes: ['更新支付重试日志']
				}
			],
			summary: '异常发生前 48 小时内没有新的服务版本发布。'
		},
		databasePool: {
			activeConnections: 100,
			maxConnections: 100,
			waitingRequests: 47,
			acquireLatencyP95Ms: 3820,
			longestRunningQuery: {
				durationSeconds: 92,
				source: 'reconciliation-report',
				sqlType: 'aggregate'
			},
			summary:
				'连接池已经耗尽，47 个请求正在等待；对账报表聚合查询长期占用连接。'
		}
	}
}

/**
 * 根据命令行场景名读取故障数据。
 *
 * @param {string} scenarioName 场景名称
 * @returns {object} 对应的故障数据
 */
export function getIncidentScenario(scenarioName) {
	const scenario = incidentScenarios[scenarioName]
	if (!scenario) {
		throw new Error(
			`未知场景 ${scenarioName}。可选值：${Object.keys(incidentScenarios).join('、')}`
		)
	}
	return scenario
}


