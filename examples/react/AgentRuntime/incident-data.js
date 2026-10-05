/**
 * 本节沿用上一节的 payment-service 故障数据。
 *
 * Runtime 只负责控制执行过程，不负责判断这些证据是否足以
 * 支持最终故障结论。更完整的结果校验会放在下一节。
 */
const incident = {
	serviceName: 'payment-service',
	metrics: {
		firstAnomalyAt: '2026-07-28T15:10:06+08:00',
		http5xxRate: 31.8,
		p95LatencyMs: 2140,
		databasePoolUsagePercent: 46,
		summary:
			'5xx 和延迟在 15:10 同时升高，但数据库连接池使用率正常。'
	},
	logs: {
		errorCode: 'PAYMENT_CURRENCY_UNDEFINED',
		firstSeenAt: '2026-07-28T15:10:08+08:00',
		version: 'v2.4.1',
		summary:
			'主要错误来自 currency 字段读取失败，错误实例均运行 v2.4.1。'
	},
	deployments: {
		version: 'v2.4.1',
		completedAt: '2026-07-28T15:09:42+08:00',
		changes: ['重构支付请求中的币种归一化逻辑'],
		summary:
			'v2.4.1 在异常出现前完成发布，并修改了发生报错的币种归一化逻辑。'
	}
}

module.exports = {
	incident
}
