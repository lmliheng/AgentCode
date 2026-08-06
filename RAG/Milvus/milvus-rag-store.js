import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import {
	DataType,
	IndexType,
	MetricType,
	MilvusClient
} from '@zilliz/milvus2-sdk-node'

// 智谱 Embedding API Key，用来把文本转换成向量。
const apiKey = process.env.ZHIPU_API_KEY

// Embedding 模型名称，默认使用智谱的 embedding-3。
const embeddingModel = process.env.EMBEDDING_MODEL ?? 'embedding-3'

// 向量维度，必须和后面 Milvus Collection 里的 FloatVector dim 保持一致。
const dimensions = Number(process.env.EMBEDDING_DIMENSIONS ?? 512)

// Milvus 中的 Collection 名称，可以理解为“向量表”。
const collectionName = process.env.MILVUS_COLLECTION ?? 'agent_course_chunks'

// 上一节文档分块后生成的 chunks.json 文件路径。
const chunksFile = path.resolve(
	process.cwd(),
	'../04-document-chunking/output/chunks.json'
)

// embedding-3 支持的向量维度范围。
const supportedDimensions = new Set([256, 512, 1024, 2048])

/**
 * 检查 Milvus 操作是否成功。
 *
 * Milvus SDK 的很多操作都会返回 status。
 * 如果 status code 不是 0，或者 error_code 不是 Success，就说明操作失败。
 */
function ensureOk(response, action) {
	const status = response?.status ?? response
	const code = Number(status?.code ?? 0)
	const errorCode = status?.error_code

	if (code !== 0 || (errorCode && errorCode !== 'Success')) {
		throw new Error(`${action} 失败：${JSON.stringify(status)}`)
	}
}

/**
 * 创建 Milvus 客户端。
 *
 * 这里同时兼容两种连接方式：
 * 1. 本地 Milvus：只配置 MILVUS_ADDRESS 即可；
 * 2. Token 认证：适合 Zilliz Cloud；
 */
function createClient() {
	const address = process.env.MILVUS_ADDRESS ?? 'localhost:19530'
	const token = process.env.MILVUS_TOKEN?.trim()

	return new MilvusClient({
		address,
		token
	})
}

/**
 * 调用智谱 Embedding API，把文本数组转换成向量数组。
 *
 * 输入：
 * ['退款规则', '发货规则']
 *
 * 输出：
 * [
 *   [0.01, 0.23, ...],
 *   [0.08, 0.11, ...]
 * ]
 */
async function createEmbeddings(inputs) {
	if (!apiKey) {
		throw new Error('没有检测到 ZHIPU_API_KEY，请先在 .env 中配置。')
	}

	// Embedding 维度必须是模型支持的维度。
	if (!supportedDimensions.has(dimensions)) {
		throw new Error('EMBEDDING_DIMENSIONS 只能是 256、512、1024 或 2048。')
	}

	// embedding-3 单次最多处理 64 条文本。
	// 如果真实项目里 Chunk 很多，需要自己做 batch 分批调用。
	if (inputs.length > 64) {
		throw new Error('embedding-3 单次请求的数组最大不能超过 64 条。')
	}

	const response = await fetch(
		'https://open.bigmodel.cn/api/paas/v4/embeddings',
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: embeddingModel,
				input: inputs,
				dimensions
			})
		}
	)

	const result = await response.json()

	if (!response.ok) {
		throw new Error(
			`Embedding API 调用失败：${response.status} ${JSON.stringify(result)}`
		)
	}

	// API 返回结果里带 index。
	// 这里先按 index 排序，确保返回向量顺序和 inputs 顺序一致。
	return result.data
		.sort((first, second) => first.index - second.index)
		.map((item) => item.embedding)
}

/**
 * 读取上一节生成的 chunks.json。
 *
 * 每个 Chunk 通常包含：
 * - chunkId
 * - content
 * - metadata
 */
async function readChunks() {
	const rawText = await readFile(chunksFile, 'utf8')
	return JSON.parse(rawText)
}

/**
 * 确保 Milvus Collection 存在。
 *
 * 如果 Collection 已存在：
 * - RESET_COLLECTION=true：先删除，再重新创建；
 * - 否则：直接 load 到内存，供后续检索使用。
 *
 * 如果 Collection 不存在：
 * - 创建 Collection；
 * - 创建向量索引；
 * - load Collection。
 */
async function ensureCollection(client) {
	const exists = await client.hasCollection({
		collection_name: collectionName
	})

	if (exists.value) {
		if (process.env.RESET_COLLECTION === 'true') {
			// 开发调试时可以重置 Collection，避免旧数据影响结果。
			await client.dropCollection({ collection_name: collectionName })
		} else {
			// Collection 已存在时，加载到内存后即可使用。
			await client.loadCollection({ collection_name: collectionName })
			return
		}
	}

	await client.createCollection({
		collection_name: collectionName,
		fields: [
			{
				// Chunk 的唯一 ID，作为主键。
				name: 'chunk_id',
				data_type: DataType.VarChar,
				is_primary_key: true,
				max_length: 256
			},
			{
				// Chunk 原文内容，检索命中后需要返回给大模型作为上下文。
				name: 'content',
				data_type: DataType.VarChar,
				max_length: 4096
			},
			{
				// 原始文档来源，例如 refund-policy.md。
				name: 'source',
				data_type: DataType.VarChar,
				max_length: 512
			},
			{
				// 文档标题，例如“蓝鲸退款规则”。
				name: 'title',
				data_type: DataType.VarChar,
				max_length: 512
			},
			{
				// 文档分类，用于 Metadata Filter，例如 refund、shipping、invoice。
				name: 'category',
				data_type: DataType.VarChar,
				max_length: 128
			},
			{
				// 文档归属方，例如 customer-service。
				name: 'owner',
				data_type: DataType.VarChar,
				max_length: 128
			},
			{
				// 文档版本号，用于区分不同版本的知识。
				name: 'source_version',
				data_type: DataType.VarChar,
				max_length: 128
			},
			{
				// 当前 Chunk 在原文档里的顺序。
				name: 'chunk_index',
				data_type: DataType.Int32
			},
			{
				// 内容 hash，用于判断内容是否发生变化，也可以参与生成稳定的 chunk_id。
				name: 'content_hash',
				data_type: DataType.VarChar,
				max_length: 128
			},
			{
				// 真正用于向量检索的字段。
				// dim 必须和 Embedding API 返回的向量维度一致。
				name: 'embedding',
				data_type: DataType.FloatVector,
				dim: dimensions
			}
		],
		index_params: [
			{
				// 给 embedding 字段创建向量索引。
				field_name: 'embedding',

				// AUTOINDEX 让 Milvus / Zilliz 自动选择合适的索引策略。
				index_type: IndexType.AUTOINDEX,

				// 使用余弦相似度，适合大多数文本向量检索场景。
				metric_type: MetricType.COSINE
			}
		]
	})

	// 创建完成后，需要 load 到内存，后续才能执行 search。
	await client.loadCollection({ collection_name: collectionName })
}

/**
 * 把文档 Chunk 转换成 Milvus 可以写入的一行数据。
 *
 * chunk 是原始业务数据；
 * embedding 是这个 Chunk 的向量。
 */
function toRow(chunk, embedding) {
	return {
		chunk_id: chunk.chunkId,
		content: chunk.content,
		source: chunk.metadata.source,
		title: chunk.metadata.title,
		category: chunk.metadata.category,
		owner: chunk.metadata.owner,
		source_version: chunk.metadata.sourceVersion,
		chunk_index: chunk.metadata.chunkIndex,
		content_hash: chunk.metadata.contentHash,
		embedding
	}
}

/**
 * 写入 Chunk 到 Milvus。
 *
 * 核心流程：
 * 1. 取出所有 Chunk 内容；
 * 2. 调用 Embedding API 生成向量；
 * 3. 把 Chunk + 向量组装成 Milvus row；
 * 4. insert 写入；
 * 5. flush 落盘；
 * 6. load Collection，确保后续可以检索。
 */
async function insertChunks(client, chunks) {
	// 取出每个 Chunk 的正文内容，并批量调用 Embedding 模型生成向量。
	// embeddings[index] 和 chunks[index] 是一一对应的。
	const embeddings = await createEmbeddings(
		chunks.map((chunk) => chunk.content)
	)

	// 将 Chunk 元数据、正文内容、Embedding 向量组装成 Milvus 的写入格式。
	// toRow 内部通常会把 chunk_id、source、content、version、vector 等字段整理成一行数据。
	const rows = chunks.map((chunk, index) => toRow(chunk, embeddings[index]))

	// 将整理好的 rows 批量写入 Milvus collection。
	const result = await client.insert({
		collection_name: collectionName,
		data: rows
	})

	// 检查 Milvus 返回结果，确认本次写入是否成功。
	ensureOk(result, '写入 Chunk')

	// flushSync 会等待数据真正写入存储层。
	// 这样可以避免刚 insert 完，数据还没完全落盘时就立刻去检索。
	await client.flushSync({
		collection_names: [collectionName]
	})

	// 写入后重新 load collection。
	// 目的是确保最新写入的数据进入可检索状态，后续 search 能查到新 Chunk。
	await client.loadCollection({
		collection_name: collectionName
	})

	// 返回本次实际写入的 Chunk 数量，方便外层打印日志或做结果统计。
	return rows.length
}

/**
 * 以表格形式打印检索结果。
 *
 * 这里不会打印完整 content，只截取前 60 个字符，
 * 方便在命令行里观察结果。
 */
function printSearchResults(results) {
	console.table(
		results.map((item, index) => ({
			rank: index + 1,
			score: Number(item.score).toFixed(6),
			chunk_id: item.chunk_id ?? item.id,
			title: item.title,
			category: item.category,
			source_version: item.source_version,
			content: String(item.content).slice(0, 60)
		}))
	)
}

/**
 * 根据用户问题执行向量检索。
 *
 * 核心流程：
 * 1. 先把用户问题转换成 queryVector；
 * 2. 在 Milvus 里用 queryVector 搜索最相似的 Chunk；
 * 3. 可选使用 Metadata Filter 缩小检索范围；
 * 4. 返回 TopK 结果。
 */
async function searchQuestion(client, question, filter) {
	const [queryVector] = await createEmbeddings([question])

	const result = await client.search({
		collection_name: collectionName,

		// 指定在哪个向量字段上做 ANN Search。
		anns_field: 'embedding',

		// 查询向量。这里传数组，是因为 Milvus 支持一次查多个向量。
		data: [queryVector],

		// 返回最相似的前 3 条。
		limit: 3,

		// Metadata Filter，例如：category == "refund"。
		filter,

		// 指定检索结果里需要返回哪些字段。
		output_fields: [
			'chunk_id',
			'content',
			'source',
			'title',
			'category',
			'owner',
			'source_version',
			'chunk_index',
			'content_hash'
		]
	})

	return result.results
}

/**
 * 生成短 hash。
 *
 * 这里取 sha256 的前 12 位，
 * 用来参与生成 chunk_id，方便标识内容版本。
 */
function hash(text) {
	return createHash('sha256').update(text).digest('hex').slice(0, 12)
}

/**
 * 构造一批“更新后的退款规则 Chunk”。
 *
 * 这个函数用来模拟文档更新场景：
 * 原来的退款规则可能是“超过 2000 元人工审核”，
 * 更新后变成“超过 5000 元人工审核”。
 */
function createUpdatedRefundChunks() {
	const version = '2026-07-01'
	const chunks = [
		{
			content: `# 蓝鲸退款规则

普通商品签收后 7 天内可以申请退款。

生鲜商品不支持无理由退款。

退款金额超过 5000 元时，需要进入人工审核流程。

用户提交退款申请后，系统会先校验订单状态、签收时间和商品类型。`,
			chunkIndex: 1
		},
		{
			content: `如果订单命中人工审核规则，退款申请会进入客服审核队列。

客服审核通过后，系统再进入退款打款流程。`,
			chunkIndex: 2
		}
	]

	return chunks.map((chunk) => {
		const contentHash = hash(chunk.content)

		// chunk_id 中包含：
		// - 文档来源标识；
		// - 文档版本；
		// - Chunk 顺序；
		// - 内容 hash。
		const chunkId = `refund-policy:${version}:${String(
			chunk.chunkIndex
		).padStart(3, '0')}:${contentHash}`

		return {
			chunkId,
			content: chunk.content,
			metadata: {
				source: 'refund-policy.md',
				title: '蓝鲸退款规则',
				category: 'refund',
				owner: 'customer-service',
				sourceVersion: version,
				chunkIndex: chunk.chunkIndex,
				contentHash,
				chunkLength: chunk.content.length
			}
		}
	})
}

/**
 * 初始化入库。
 *
 * 执行命令：
 * node --env-file=.env milvus-rag-store.js setup
 *
 * 作用：
 * 1. 连接 Milvus；
 * 2. 确保 Collection 存在；
 * 3. 读取 chunks.json；
 * 4. 生成向量；
 * 5. 写入 Milvus。
 */
async function setup() {
	const client = createClient()
	await client.connectPromise

	await ensureCollection(client)

	const chunks = await readChunks()
	const count = await insertChunks(client, chunks)

	console.log(`已写入 Chunk 数量：${count}`)
}

/**
 * 执行一次向量检索。
 *
 * 执行命令：
 * node --env-file=.env milvus-rag-store.js search
 *
 * 这里的问题是：
 * “3000 元退款需要人工审核吗？”
 *
 * 同时使用 Metadata Filter：
 * category == "refund"
 *
 * 也就是只在退款类知识中检索。
 */
async function search() {
	const client = createClient()
	await client.connectPromise
	await ensureCollection(client)

	const question = '3000 元退款需要人工审核吗？'
	const filter = 'category == "refund"'

	console.log(`用户问题：${question}`)
	console.log(`Metadata Filter：${filter}`)

	const results = await searchQuestion(client, question, filter)
	printSearchResults(results)
}

/**
 * 模拟退款规则更新。
 *
 * 执行命令：
 * node --env-file=.env milvus-rag-store.js update
 *
 * 核心流程：
 * 1. 删除 source == "refund-policy.md" 的旧 Chunk；
 * 2. 构造新版退款规则 Chunk；
 * 3. 重新生成 Embedding；
 * 4. 写入新版 Chunk；
 * 5. 再次检索，观察结果是否变成新版规则。
 */
async function updateRefundRule() {
	const client = createClient()
	await client.connectPromise
	await ensureCollection(client)

	// 删除旧版本退款规则。
	// 注意：这里按 source 删除，会删除 refund-policy.md 下的所有旧 Chunk。
	await client.delete({
		collection_name: collectionName,
		filter: 'source == "refund-policy.md"'
	})

	const updatedChunks = createUpdatedRefundChunks()
	const count = await insertChunks(client, updatedChunks)

	console.log(`退款规则已更新，新写入 Chunk 数量：${count}`)

	const question = '3000 元退款需要人工审核吗？'
	const results = await searchQuestion(client, question, 'category == "refund"')

	console.log(`更新后再次检索：${question}`)
	printSearchResults(results)
}

// 从命令行读取动作参数。
// 例如：
// node --env-file=.env milvus-rag-store.js setup
// node --env-file=.env milvus-rag-store.js search
// node --env-file=.env milvus-rag-store.js update
const action = process.argv[2]

// 执行初始化入库的逻辑
if (action === 'setup') {
	await setup()
}
// 执行一次搜索的逻辑
else if (action === 'search') {
	await search()
}
// 执行一次更新的逻辑
else if (action === 'update') {
	await updateRefundRule()
} else {
	console.log(
		'请执行：node --env-file=.env milvus-rag-store.js setup|search|update'
	)
}
