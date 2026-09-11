const orders = new Map([
	[
		'A1024',
		{
			orderId: 'A1024',
			status: 'delivered',
			productName: '咖啡机',
			category: 'normal',
			signedDays: 3,
			refundAmount: 3000
		}
	],
	[
		'B2048',
		{
			orderId: 'B2048',
			status: 'delivered',
			productName: '冷鲜牛排',
			category: 'fresh',
			signedDays: 1,
			refundAmount: 199
		}
	]
])

/**
 * 查询订单详情。
 *
 * 这里继续使用内存数据模拟企业订单系统；
 * 换成真实项目时，通常会改成数据库、HTTP 或 RPC 调用。
 */
export async function getOrderById(orderId) {
	const order = orders.get(orderId)

	if (!order) {
		return {
			ok: false,
			error: {
				code: 'ORDER_NOT_FOUND',
				message: `没有找到订单 ${orderId}`
			}
		}
	}

	return {
		ok: true,
		order: { ...order }
	}
}

/**
 * 根据售后规则做退款预检。
 *
 * 这类确定性规则不需要交给模型判断；
 * MCP Tool 只负责把业务系统能力标准化暴露出去。
 */
export async function checkRefundEligibility(orderId) {
	const result = await getOrderById(orderId)

	if (!result.ok) {
		return result
	}

	const { order } = result

	if (order.category === 'fresh') {
		return {
			ok: true,
			eligible: false,
			manualReview: false,
			reason: '生鲜商品不支持无理由退款。'
		}
	}

	if (order.signedDays > 7) {
		return {
			ok: true,
			eligible: false,
			manualReview: false,
			reason: `订单已签收 ${order.signedDays} 天，超过 7 天退款期限。`
		}
	}

	if (order.refundAmount > 2000) {
		return {
			ok: true,
			eligible: true,
			manualReview: true,
			reason: `退款金额 ${order.refundAmount} 元，超过 2000 元，需要人工审核。`
		}
	}

	return {
		ok: true,
		eligible: true,
		manualReview: false,
		reason: '订单满足自动退款条件。'
	}
}
