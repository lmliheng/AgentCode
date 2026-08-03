import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const serverPath = fileURLToPath(
	new URL('./after-sales-mcp-server.js', import.meta.url)
)

function printTitle(title) {
	console.log(`\n================ ${title} ================`)
}

function printTextResult(result) {
	const text = result.content?.find((item) => item.type === 'text')?.text
	console.log(text ?? result)
}

/**
 * 售后能力辨别 clinet
 */
const client = new Client({
	name: 'after-sales-capabilities-verify-client',
	version: '1.0.0'
})

const transport = new StdioClientTransport({
	command: process.execPath,
	args: [serverPath],
	stderr: 'inherit'
})

try {
	// 连接server
	await client.connect(transport)

	printTitle('1. 查看 Server 能力')
	console.log('Server:', client.getServerVersion())
	console.log('Capabilities:', client.getServerCapabilities())

	printTitle('2. 查看 Tools')
	const { tools } = await client.listTools()
	for (const tool of tools) {
		console.log(`- ${tool.name}：${tool.description}`)
	}

	printTitle('3. 调用退款预检 Tool')
	const refundResult = await client.callTool({
		name: 'check_refund_eligibility',
		arguments: {
			orderId: 'A1024'
		}
	})
	printTextResult(refundResult)

	printTitle('4. 读取 Resource')
	const { resources } = await client.listResources()
	for (const resource of resources) {
		console.log(`- ${resource.uri}：${resource.description}`)
	}

	const policy = await client.readResource({
		uri: 'refund-policy://default'
	})
	console.log(policy.contents[0]?.text)

	printTitle('5. 获取 Prompt')
	const { prompts } = await client.listPrompts()
	for (const prompt of prompts) {
		console.log(`- ${prompt.name}：${prompt.description}`)
	}

	const prompt = await client.getPrompt({
		name: 'refund-review',
		arguments: {
			orderId: 'A1024',
			customerQuestion: '3000 元的咖啡机退款，需要人工审核吗？'
		}
	})
	console.dir(prompt.messages, { depth: null })

	printTitle('6. 验证未知订单')
	const unknownOrder = await client.callTool({
		name: 'get_order',
		arguments: {
			orderId: 'UNKNOWN'
		}
	})
	printTextResult(unknownOrder)
} finally {
	await client.close()
	console.log('\n[Client] 验证结束，关闭连接')
}
