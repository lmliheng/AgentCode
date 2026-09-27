import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { callDeepSeek, MODEL } from './deepseek-client.js'

/**
 * Host 最多允许模型进行 4 轮工具调用。
 *
 * 每一轮中，模型可能：
 * 1. 返回 tool_calls，要求调用一个或多个工具；
 * 2. 不再调用工具，直接返回最终回答。
 *
 * 设置最大轮次可以防止模型不断调用工具，形成死循环。
 */
const MAX_TOOL_ROUNDS = 4

/**
 * 是否只验证 MCP Server 的能力发现。
 *
 * 执行：
 * node host.js --discover
 *
 * Host 只连接 MCP Server，读取 Tools、Resources 和 Prompts，
 * 不会调用大模型，也不会执行任何工具。
 */
const isDiscoverOnly = process.argv.includes('--discover')

/**
 * 读取命令行中的用户问题。
 *
 * process.argv 前两个元素分别是 Node.js 路径和当前脚本路径，
 * 所以从索引 2 开始读取，并排除 --discover 参数。
 */
const question = process.argv
	.slice(2)
	.filter((argument) => argument !== '--discover')
	.join(' ')
	.trim()

/**
 * 如果命令行没有传入问题，就使用默认的售后问题。
 *
 * 例如可以这样传入自定义问题：
 *
 * node host.js "订单 A2048 是否可以退款？"
 */
const userQuestion =
	question || '订单 A1024 是否满足退款条件？如果可以退款，是否需要人工审核？'

/**
 * 获取 MCP Server 脚本的绝对路径。
 *
 * StdioClientTransport 需要通过 Node.js 子进程启动这个 Server，
 * 因此这里不能只依赖当前命令行所在目录的相对路径。
 */
const serverPath = fileURLToPath(
	new URL('./after-sales-mcp-server.js', import.meta.url)
)

/**
 * 打印带有分隔线的步骤标题，方便观察 Host 的完整执行流程。
 *
 * @param {string} title 步骤标题
 */
function printTitle(title) {
	console.log(`\n================ ${title} ================`)
}

/**
 * 把 MCP Server 暴露的 Tool 定义转换成 DeepSeek Tool Calling
 * 所要求的工具定义格式。
 *
 * MCP Tool 的主要结构：
 *
 * {
 *   name,
 *   description,
 *   inputSchema
 * }
 *
 * 模型接口要求的主要结构：
 *
 * {
 *   type: 'function',
 *   function: {
 *     name,
 *     description,
 *     parameters
 *   }
 * }
 *
 * MCP 和模型接口都使用 JSON Schema 描述工具参数，
 * 因此 Host 不需要重新编写参数 Schema，只需要调整外层结构。
 *
 * @param {Array} mcpTools MCP Server 返回的工具列表
 * @returns {Array} 可以提交给模型的 Tools
 */
function toModelTools(mcpTools) {
	return mcpTools.map((tool) => {
		/**
		 * 部分 MCP Tool 的 inputSchema 中可能包含 $schema 字段，
		 * 但模型接口通常只需要 type、properties、required 等内容。
		 */
		const { $schema, ...parameters } = tool.inputSchema

		return {
			type: 'function',
			function: {
				name: tool.name,
				description: tool.description || '',
				parameters
			}
		}
	})
}

/**
 * 把 MCP Tool 的执行结果转换成模型 Tool Message 使用的字符串。
 *
 * MCP Tool 返回的是 content blocks：
 *
 * {
 *   content: [
 *     { type: 'text', text: '...' }
 *   ]
 * }
 *
 * 模型的 role=tool 消息要求 content 是字符串，因此 Host 需要在这里
 * 将 MCP 返回结果标准化并序列化。
 *
 * MCP 允许返回文本、图片等多种类型的内容块。当前售后示例主要返回文本；
 * 如果出现非文本结果，也会保留原始 content，避免 Host 静默丢失信息。
 *
 * @param {object} result MCP Client 调用 Tool 后得到的结果
 * @returns {string} 可以放入模型 tool 消息的字符串
 */
function toModelToolResult(result) {
	/**
	 * 找出所有文本类型的内容块，并使用换行符合并。
	 */
	const text = result.content
		?.filter((item) => item.type === 'text')
		.map((item) => item.text)
		.join('\n')

	/**
	 * 按照以下优先级选择实际结果：
	 *
	 * 1. 文本内容；
	 * 2. structuredContent 结构化结果；
	 * 3. 原始 content blocks；
	 * 4. null。
	 */
	let normalizedResult =
		text || result.structuredContent || result.content || null

	/**
	 * 当前售后 MCP Tool 返回的文本通常是 JSON 字符串。
	 *
	 * 如果能够解析，就恢复成 JavaScript 对象，让模型看到更明确的
	 * 字段结构；如果只是普通文本，则直接保留原始内容。
	 */
	if (text) {
		try {
			normalizedResult = JSON.parse(text)
		} catch {
			// 普通文本不是异常，不需要额外处理。
		}
	}

	/**
	 * role=tool 的 content 最终必须是字符串，
	 * 所以统一使用 JSON.stringify 序列化。
	 */
	return JSON.stringify({
		toolExecutionSucceeded: !result.isError,
		result: normalizedResult
	})
}

/**
 * 执行模型提出的一次工具调用。
 *
 * 整个调用链为：
 *
 * 模型返回 tool_call
 *      ↓
 * Host 解析工具名和参数
 *      ↓
 * Host 把调用请求交给 MCP Client
 *      ↓
 * MCP Client 调用 MCP Server
 *      ↓
 * MCP Server 校验参数并执行业务逻辑
 *
 * 这里需要注意：
 *
 * - 模型不会直接调用 MCP Server；
 * - MCP Client 不负责决定调用哪个工具；
 * - Host 负责在模型接口和 MCP Client 之间进行调度。
 *
 * @param {Client} client 已连接 MCP Server 的 Client
 * @param {Set<string>} availableToolNames 当前 Server 实际提供的工具名
 * @param {object} toolCall 模型返回的一次 tool_call
 * @returns {Promise<string>} 可以回传给模型的工具结果
 */
async function executeMcpTool(client, availableToolNames, toolCall) {
	const toolName = toolCall.function.name

	/**
	 * 不直接信任模型返回的工具名。
	 *
	 * 模型只能调用本次通过 MCP 能力发现获得的工具，
	 * 防止模型请求调用不存在或未开放的工具。
	 */
	if (!availableToolNames.has(toolName)) {
		return JSON.stringify({
			ok: false,
			error: {
				code: 'MCP_TOOL_NOT_AVAILABLE',
				message: `当前 MCP Server 没有提供工具 ${toolName}`
			}
		})
	}

	let toolArguments

	/**
	 * 模型返回的 function.arguments 是 JSON 字符串，
	 * Host 需要先将其解析为对象，才能传给 MCP Client。
	 */
	try {
		toolArguments = JSON.parse(toolCall.function.arguments || '{}')
	} catch {
		return JSON.stringify({
			ok: false,
			error: {
				code: 'INVALID_TOOL_ARGUMENTS',
				message: '模型返回的工具参数不是合法 JSON。'
			}
		})
	}

	try {
		/**
		 * Client 通过 MCP 协议把工具调用发送给 MCP Server。
		 *
		 * 真正的参数 Schema 校验和业务逻辑执行都在 Server 中完成，
		 * Host 不需要重复实现业务校验。
		 */
		const result = await client.callTool({
			name: toolName,
			arguments: toolArguments
		})

		return toModelToolResult(result)
	} catch (error) {
		/**
		 * 捕获连接失败、协议错误或 Server 执行异常，
		 * 并将错误转换成模型能够读取的结构化结果。
		 */
		return JSON.stringify({
			ok: false,
			error: {
				code: 'MCP_TOOL_CALL_FAILED',
				message: error instanceof Error ? error.message : String(error)
			}
		})
	}
}

/**
 * 打印 MCP Server 已经暴露的能力。
 *
 * 连接建立后，Client 会先通过能力协商知道 Server 支持哪些能力类别，
 * 例如 tools、resources、prompts。
 *
 * 但是，能力协商只说明 Server 支持某个类别，不包含具体能力明细。
 * Host 还需要继续调用：
 *
 * - client.listTools()
 * - client.listResources()
 * - client.listPrompts()
 *
 * 才能获得具体列表。
 *
 * @param {object} capabilityInfo Server 信息及能力列表
 */
function printCapabilities({
	serverInfo,
	capabilities,
	tools,
	resources,
	prompts
}) {
	console.log(`Server：${serverInfo?.name} v${serverInfo?.version}`)
	console.log(`能力类别：${Object.keys(capabilities || {}).join('、') || '无'}`)

	console.log('\nTools：')
	for (const tool of tools) {
		console.log(`- ${tool.name}：${tool.description}`)
	}

	console.log('\nResources：')
	for (const resource of resources) {
		console.log(`- ${resource.uri}：${resource.description}`)
	}

	console.log('\nPrompts：')
	for (const prompt of prompts) {
		console.log(`- ${prompt.name}：${prompt.description}`)
	}
}

/**
 * 执行最小 MCP Host 的完整流程。
 *
 * 这个 Host 同时管理两类连接：
 *
 * 1. 通过 MCP Client 连接 MCP Server；
 * 2. 通过 callDeepSeek 调用大模型。
 *
 * Host 的核心职责包括：
 *
 * - 创建和管理 MCP Client；
 * - 发现 MCP Server 暴露的能力；
 * - 把 MCP Tools 转换成模型 Tools；
 * - 调用模型；
 * - 接收模型返回的 tool_calls；
 * - 通过 MCP Client 执行工具；
 * - 把工具结果放回 messages；
 * - 再次调用模型，直到模型生成最终回答。
 */
async function runHost() {
	/**
	 * 创建 MCP Client。
	 *
	 * Client 是 Host 内部的协议通信组件，只负责与当前 MCP Server 通信，
	 * 不调用大模型，也不负责判断应该使用哪个工具。
	 */
	const client = new Client({
		name: 'after-sales-minimal-host-client',
		version: '1.0.0'
	})

	/**
	 * 创建 stdio 传输层。
	 *
	 * StdioClientTransport 会执行：
	 *
	 * node after-sales-mcp-server.js
	 *
	 * 启动 MCP Server 子进程，并通过标准输入和标准输出传输 MCP 协议消息。
	 *
	 * stderr: 'inherit' 表示 Server 写入 stderr 的调试日志
	 * 会直接显示在当前终端中。
	 */
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [serverPath],
		stderr: 'inherit'
	})

	try {
		printTitle('1. MCP Client 连接 Server')

		/**
		 * 建立 MCP Client 与 MCP Server 之间的连接。
		 *
		 * 连接过程中双方会完成初始化和能力协商。
		 */
		await client.connect(transport)

		/**
		 * 读取 Server 在初始化阶段声明的能力类别。
		 */
		const capabilities = client.getServerCapabilities() || {}

		/**
		 * 只有 Server 声明支持对应能力时，才发送具体的列表请求。
		 *
		 * 这样可以避免向不支持该能力的 Server 发送无效请求。
		 */
		const { tools } = capabilities.tools
			? await client.listTools()
			: { tools: [] }

		const { resources } = capabilities.resources
			? await client.listResources()
			: { resources: [] }

		const { prompts } = capabilities.prompts
			? await client.listPrompts()
			: { prompts: [] }

		printCapabilities({
			serverInfo: client.getServerVersion(),
			capabilities,
			tools,
			resources,
			prompts
		})

		printTitle('2. MCP Tools 转成模型 Tools')

		/**
		 * MCP Server 返回的 Tool 结构不能直接提交给 DeepSeek，
		 * Host 需要先转换成模型 Tool Calling 接口要求的格式。
		 */
		const modelTools = toModelTools(tools)

		for (const tool of modelTools) {
			console.log(`- ${tool.function.name}`)
			console.dir(tool.function.parameters, { depth: null })
		}

		/**
		 * --discover 模式只验证 MCP 能力发现，
		 * 到这里就结束，不进入模型调用流程。
		 */
		if (isDiscoverOnly) {
			console.log('\n能力发现验证结束，本次没有调用模型。')
			return
		}

		/**
		 * 没有 Tools 时，模型无法通过 Tool Calling 调用 MCP Server，
		 * 因此直接终止当前 Host 流程。
		 */
		if (modelTools.length === 0) {
			throw new Error('当前 MCP Server 没有可交给模型使用的 Tools。')
		}

		/**
		 * 保存本次能力发现得到的工具名。
		 *
		 * 后续执行模型 tool_call 时，用它检查模型请求的工具
		 * 是否确实由当前 MCP Server 提供。
		 */
		const availableToolNames = new Set(tools.map((tool) => tool.name))

		/**
		 * 初始化模型上下文。
		 *
		 * 后续每次模型返回 tool_calls，以及每次 MCP Tool 返回结果，
		 * 都会继续追加到这个 messages 数组中。
		 */
		const messages = [
			{
				role: 'system',
				content:
					'你是星河零售的售后助手。订单信息和退款判断必须以工具结果为准，不能自行编造。工具失败时请直接说明失败原因。'
			},
			{
				role: 'user',
				content: userQuestion
			}
		]

		printTitle('3. Host 开始处理用户问题')
		console.log(`模型：${MODEL}`)
		console.log(`用户：${userQuestion}`)

		/**
		 * 开始执行 Tool Calling 循环。
		 *
		 * 每一轮都会调用一次模型：
		 *
		 * - 模型返回 tool_calls：执行工具并进入下一轮；
		 * - 模型不返回 tool_calls：说明已经生成最终回答，结束循环。
		 */
		for (let round = 1; round <= MAX_TOOL_ROUNDS; round += 1) {
			console.log(`\n--- 第 ${round} 轮模型调用 ---`)

			/**
			 * Host 将当前完整 messages 和可用工具定义交给模型。
			 *
			 * 模型只能提出工具调用请求，不会直接执行 MCP Tool。
			 */
			const modelResult = await callDeepSeek({
				messages,
				tools: modelTools
			})

			const toolCalls = modelResult.message.tool_calls || []

			console.log(`finish_reason：${modelResult.finishReason}`)
			console.log(`耗时：${modelResult.latencyMs}ms`)

			/**
			 * 模型没有返回 tool_calls，表示当前已经不需要继续使用工具，
			 * message.content 就是最终回答。
			 */
			if (toolCalls.length === 0) {
				console.log('\n最终回答：')
				console.log(modelResult.message.content)
				return
			}

			/**
			 * 先把模型返回的 assistant 消息完整加入上下文。
			 *
			 * tool_calls 必须保留下来，因为后续的 role=tool 消息
			 * 需要通过 tool_call_id 与这次调用建立对应关系。
			 */
			messages.push({
				role: 'assistant',
				content: modelResult.message.content ?? null,
				tool_calls: toolCalls
			})

			/**
			 * 一次模型响应可能同时包含多个 tool_call，
			 * Host 依次执行每一个工具调用。
			 */
			for (const toolCall of toolCalls) {
				console.log('\n模型提出工具调用：')
				console.log(`- 工具：${toolCall.function.name}`)
				console.log(`- 参数：${toolCall.function.arguments}`)

				/**
				 * Host 把模型生成的工具名和参数交给 MCP Client。
				 *
				 * MCP Client 再通过 MCP 协议请求 MCP Server 执行工具。
				 */
				const toolResult = await executeMcpTool(
					client,
					availableToolNames,
					toolCall
				)

				console.log('MCP Tool 返回：')
				console.log(toolResult)

				/**
				 * 把工具执行结果作为 role=tool 消息追加到上下文。
				 *
				 * 下一轮调用模型时，模型就可以读取这次真实工具结果，
				 * 判断是否还需要继续调用其他工具，或者生成最终答案。
				 */
				messages.push({
					role: 'tool',
					tool_call_id: toolCall.id,
					content: toolResult
				})
			}
		}

		/**
		 * 达到最大轮次后模型仍然没有生成最终回答，
		 * Host 主动终止，避免进入无限工具调用循环。
		 */
		throw new Error(
			`已经达到最大工具调用轮次 ${MAX_TOOL_ROUNDS}，Host 主动停止。`
		)
	} finally {
		/**
		 * 无论流程正常结束还是出现异常，都关闭 MCP Client。
		 *
		 * 对于 stdio 传输层，关闭 Client 时也会结束对应的
		 * MCP Server 子进程并释放相关资源。
		 */
		await client.close()
		console.log('\n[Host] MCP Client 已关闭')
	}
}

/**
 * 启动 Host。
 *
 * runHost 内部未处理的异常会在这里统一输出，
 * 并设置非零退出码，表示本次程序执行失败。
 */
runHost().catch((error) => {
	console.error('\n运行失败：', error instanceof Error ? error.message : error)
	process.exitCode = 1
})
