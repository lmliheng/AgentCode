import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

/**
 * 引入 Server 背后的真实业务能力。
 *
 * MCP Server 本身不负责保存订单数据或实现退款规则，
 * 而是把现有订单系统中的函数包装成标准 MCP 能力。
 */
import { checkRefundEligibility, getOrderById } from './order-system.js'

/**
 * 引入需要通过 Resource 暴露的退款规则。
 *
 * refundPolicyUri：
 * 退款规则对应的资源 URI。
 *
 * refundPolicyText：
 * 退款规则的实际文本内容。
 */
import { refundPolicyText, refundPolicyUri } from './refund-policy.js'

/**
 * 创建 MCP Server。
 *
 * name 和 version 用于标识当前 Server，
 * MCP Client 建立连接后可以读取这些基础信息。
 */
const server = new McpServer({
	name: 'after-sales-capabilities-server',
	version: '1.0.0'
})

/**
 * 注册 get_order Tool。
 *
 * Tool 表示一项可以被调用和执行的能力。
 * 这个 Tool 负责根据订单号查询真实订单信息。
 */
server.registerTool(
	'get_order',
	{
		// 主要用于向 Host 或用户展示的工具名称。
		title: '查询订单',

		// 告诉调用方这个工具解决什么问题。
		description: '根据订单号查询订单详情',

		/**
		 * 工具参数结构。
		 *
		 * MCP SDK 会根据该 Schema 描述工具需要接收的参数，
		 * 同时可以在调用工具时对输入参数进行校验。
		 */
		inputSchema: {
			orderId: z.string().describe('订单号，例如 A1024')
		}
	},

	/**
	 * Tool 的真实执行函数。
	 *
	 * MCP Client 调用 get_order 后，
	 * MCP Server 会进入这个回调并调用背后的订单系统。
	 */
	async ({ orderId }) => {
		/**
		 * stdio 模式下，标准输出 stdout 用于传输 MCP 协议消息。
		 *
		 * 因此调试日志应输出到 stderr，
		 * 避免 console.log 污染协议通信数据。
		 */
		console.error(`[Server] get_order orderId=${orderId}`)

		// 调用 Server 背后的真实订单查询函数。
		const result = await getOrderById(orderId)

		/**
		 * MCP Tool 的执行结果通过 content 数组返回。
		 *
		 * 这里将订单查询结果序列化成格式化的 JSON 文本，
		 * 方便 Client 或模型继续处理。
		 */
		return {
			content: [
				{
					type: 'text',
					text: JSON.stringify(result, null, 2)
				}
			]
		}
	}
)

/**
 * 注册 check_refund_eligibility Tool。
 *
 * 这个 Tool 根据订单真实数据执行退款预检，
 * 判断订单是否允许退款以及是否需要人工审核。
 */
server.registerTool(
	'check_refund_eligibility',
	{
		title: '退款预检',
		description: '根据订单信息判断是否满足退款条件，以及是否需要人工审核',

		/**
		 * 当前工具只接收订单号。
		 *
		 * 具体订单字段和退款规则由真实订单系统内部查询和判断，
		 * 不要求模型自行传递订单状态、金额等字段。
		 */
		inputSchema: {
			orderId: z.string().describe('订单号，例如 A1024')
		}
	},

	async ({ orderId }) => {
		console.error(`[Server] check_refund_eligibility orderId=${orderId}`)

		// 调用真实业务系统中的退款资格判断函数。
		const result = await checkRefundEligibility(orderId)

		return {
			content: [
				{
					type: 'text',
					text: JSON.stringify(result, null, 2)
				}
			]
		}
	}
)

/**
 * 注册 refund-policy Resource。
 *
 * Resource 表示 MCP Server 暴露的一份可读取资料，
 * 重点是提供内容，而不是执行业务动作。
 *
 * Client 可以通过资源 URI 读取售后退款规则，
 * 但是否读取以及是否将内容交给模型，由 Host 决定。
 */
server.registerResource(
	// Resource 在当前 Server 中的注册名称。
	'refund-policy',

	// Resource 对应的唯一 URI。
	refundPolicyUri,

	{
		title: '售后退款规则',
		description: '客服和售后 Agent 需要遵守的退款规则',

		// 声明资源内容为 Markdown 文本。
		mimeType: 'text/markdown'
	},

	/**
	 * Resource 的读取函数。
	 *
	 * 当 MCP Client 请求读取该 URI 时，
	 * Server 会执行这个回调并返回实际内容。
	 */
	async (uri) => {
		console.error(`[Server] read resource ${uri.href}`)

		return {
			contents: [
				{
					// 返回本次读取的资源 URI。
					uri: uri.href,

					// 返回内容的媒体类型。
					mimeType: 'text/markdown',

					// 退款规则的实际文本。
					text: refundPolicyText
				}
			]
		}
	}
)

/**
 * 注册 refund-review Prompt。
 *
 * Prompt 表示 MCP Server 提供的一套可复用任务模板。
 *
 * Host 可以通过 MCP 协议获取这套模板，
 * 再结合订单数据、退款预检结果等上下文调用大模型。
 *
 * Prompt 本身不会直接调用模型，也不会自动执行 Tools。
 */
server.registerPrompt(
	'refund-review',
	{
		title: '退款审核回复模板',
		description: '根据订单信息、退款预检结果和售后政策生成客服回复',

		/**
		 * 获取 Prompt 时需要提供的参数。
		 *
		 * orderId：
		 * 当前需要处理的订单号。
		 *
		 * customerQuestion：
		 * 用户提出的原始售后问题。
		 */
		argsSchema: {
			orderId: z.string().describe('订单号'),
			customerQuestion: z.string().describe('用户原始问题')
		}
	},

	/**
	 * 根据传入参数动态生成 Prompt 消息。
	 *
	 * MCP Client 获取 Prompt 后，
	 * 会拿到这里返回的 messages，而不是直接得到模型答案。
	 */
	({ orderId, customerQuestion }) => {
		console.error(`[Server] get prompt refund-review orderId=${orderId}`)

		return {
			description: '退款审核回复模板',

			/**
			 * 返回可以交给大模型使用的消息模板。
			 *
			 * 这里只提供任务要求、订单号和用户问题。
			 * 订单查询结果、退款预检结果和退款规则，
			 * 仍然需要由 Host 获取后补充进模型上下文。
			 */
			messages: [
				{
					role: 'user',
					content: {
						type: 'text',
						text: [
							'你是企业售后客服 Agent。',
							'请根据订单查询结果、退款预检结果和售后规则回答用户。',
							'如果资料不足，不要编造。',
							`订单号：${orderId}`,
							`用户问题：${customerQuestion}`
						].join('\n')
					}
				}
			]
		}
	}
)

// 使用 stderr 输出启动日志，避免影响 stdio 协议通信。
console.error('[Server] 售后 MCP Server 已启动')

/**
 * 创建 stdio 传输层。
 *
 * stdio 模式下：
 * - MCP Client 通过子进程标准输入向 Server 发送协议消息
 * - MCP Server 通过标准输出向 Client 返回协议消息
 *
 * 这种方式常用于本地 MCP Server。
 */
const transport = new StdioServerTransport()

/**
 * 将 MCP Server 连接到 stdio 传输层。
 *
 * 连接建立后，Server 开始等待并处理 Client 发来的请求，
 * 包括：
 * - 查询和调用 Tools
 * - 查询和读取 Resources
 * - 查询和获取 Prompts
 */
await server.connect(transport)
