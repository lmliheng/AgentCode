/**
 * @混合检索
 * 
 * 
 * 这里混合检索实现是通过Milvusz-sdk封装的混合检索方法完成
 * 
 */

import {
	DataType,
	FunctionType,
	IndexType,
	MetricType,
	MilvusClient,
	RRFRanker
} from '@zilliz/milvus2-sdk-node'

const apiKey = process.env.Z_API_KEY

// const embeddingModel = process.env.EMBEDDING_MODEL ?? 'embedding-3'
const dimensions = Number(process.env.EMBEDDING_DIMENSIONS ?? 512)

// 从环境变量中读取 Collection 名称。
const configuredCollectionName = process.env.MILVUS_COLLECTION?.trim()

// 如果没有配置 Collection，或者仍然使用上一节的旧 Collection 名称，
// 就自动改成当前混合检索示例专用的 Collection，避免覆盖之前的数据。
const collectionName =
	!configuredCollectionName ||
	configuredCollectionName === 'agent_course_chunks'
		? 'agent_course_hybrid_recall_demo'
		: configuredCollectionName

// 四种检索方案最终都只返回 Top3。
// 所以后面评估时统一使用 Recall@3。
const FINAL_TOP_K = 3

// 混合检索时，每一路会先多召回一些候选结果。
// 例如：Dense 先召回 Top5，BM25 也先召回 Top5，
// 然后再通过 Weighted 或 RRF 融合排序，最终取 Top3。
const ROUTE_TOP_K = 5

// 给不同检索方式配置一个更适合打印展示的中文名称。
const METHOD_NAMES = {
	Dense: '向量检索（Dense）',
	BM25: 'BM25 全文检索',
	Weighted: '归一化 Weighted 融合',
	RRF: 'RRF 排名融合'
}

// 模拟企业知识库中的文档。
// 每一条数据都会写入 Milvus。
const documents = [
	{
		id: 'refund-threshold',
		title: '退款金额审核规则',
		content:
			'# 蓝鲸退款规则\n\n普通商品签收后 7 天内可以申请退款。\n\n生鲜商品不支持无理由退款。\n\n退款金额超过 3000 元时，需要进入人工审核流程。\n\n用户提交退款申请后，系统会先校验订单状态、签收时间和商品类型。'
	},
	{
		id: 'refund-workflow',
		title: '人工审核流程',
		content:
			'人工审核流程。\n\n用户提交退款申请后，系统会先校验订单状态、签收时间和商品类型。\n\n如果订单命中人工审核规则，退款申请会进入客服审核队列。客服审核通过后，系统再进入退款打款流程。'
	},
	{
		id: 'order-cancellation',
		title: '高价值订单取消流程',
		content:
			'高价值交易申请撤销后不会立即关闭，需要转交业务专员复核，再决定是否终止订单。'
	},
	{
		id: 'refund-arrival',
		title: '退款到账时间',
		content: '退款原路退回银行卡通常需要 1 到 5 个工作日。'
	},
	{
		id: 'rule-map',
		title: '规则编号映射表',
		content: '内部规则映射：BW-RF-2026 对应蓝鲸退款规则。'
	},
	{
		id: 'rule-guide',
		title: '售后规则查询说明',
		content: '用户提供规则编号后，客服可以查询对应的售后规则名称和适用范围。'
	},
	{
		id: 'shipping-policy',
		title: '商品发货规则',
		content: '现货商品会在付款后 48 小时内发货。'
	},
	{
		id: 'invoice-policy',
		title: '发票开具规则',
		content: '订单完成后，用户可以在订单详情页申请电子发票。'
	}
]

// 测试用例。
// relevantIds 是人工标注的标准答案，用来判断检索结果是否命中。
const evaluationCases = [
	{
		name: '口语化退款问题',
		question:
			'这台设备花了三千五，现在想退掉，能让系统直接通过，还是必须找工作人员看一下？',
		relevantIds: ['refund-threshold', 'refund-workflow']
	},
	{
		name: '精确规则编号',
		question: 'BW-RF-2026',
		relevantIds: ['rule-map']
	},
	{
		name: '退款到账时间',
		question: '钱已经退了，什么时候能到银行卡？',
		relevantIds: ['refund-arrival']
	}
]

/**
 * 检查 Milvus 操作是否成功。
 *
 * Milvus SDK 的返回值里通常会带有 status。
 * 如果 code 不是 0，或者 error_code 不是 Success，就说明操作失败。
 *
 * @param {object} response Milvus SDK 返回的响应结果。
 * @param {string} action 当前执行的动作名称，用来拼接错误提示。
 */
function ensureOk(response, action) {
	const status = response?.status ?? response
	const code = Number(status?.code ?? 0)
	const errorCode = status?.error_code

	if (code !== 0 || (errorCode && errorCode !== 'Success')) {
		throw new Error(`${action}失败：${JSON.stringify(status)}`)
	}
}

/**
 * 获取 Milvus 连接地址。
 *
 * 默认连接本地 Milvus：127.0.0.1:19530。
 * 这里顺手把 localhost 替换成 127.0.0.1，避免部分本地环境下 localhost 解析异常。
 *
 * @returns {string} Milvus 连接地址。
 */
function getMilvusAddress() {
	const address = process.env.MILVUS_ADDRESS?.trim() || '127.0.0.1:19530'
	return address.replace(/(^|:\/\/)localhost(?=:\d+$)/, '$1127.0.0.1')
}

/**
 * 创建 Milvus 客户端，并测试连接是否成功。
 *
 * 如果连接本地 Milvus，需要先启动 Docker 服务。
 * 如果连接 Zilliz Cloud，可以通过 MILVUS_TOKEN 配置鉴权 token。
 *
 * @returns {Promise<MilvusClient>} 已连接的 Milvus 客户端。
 */
async function connectMilvus() {
	const client = new MilvusClient({
		address: getMilvusAddress(),
		token: process.env.MILVUS_TOKEN?.trim() || undefined
	})

	try {
		await client.connectPromise
		return client
	} catch {
		throw new Error(
			'无法连接 Milvus。请先执行 docker compose up -d --wait --wait-timeout 180。'
		)
	}
}

/**
 * 调用智谱 Embedding API，把文本数组转换成向量数组。
 *
 * 例如输入：
 * ['退款规则', '发货规则']
 *
 * 返回：
 * [
 *   [0.01, 0.02, ...],
 *   [0.03, 0.04, ...]
 * ]
 *
 * @param {string[]} inputs 需要生成 Embedding 的文本数组。
 * @returns {Promise<number[][]>} 文本对应的向量数组。
 */
async function createEmbeddings(inputs) {
	if (!apiKey) {
		throw new Error('没有检测到 ZHIPU_API_KEY，请先配置 .env。')
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
		throw new Error(`Embedding API 调用失败：${response.status}`)
	}

	// API 返回的数据中带有 index。
	// 这里先按 index 排序，确保返回向量的顺序和输入文本的顺序一致。
	return result.data
		.sort((first, second) => first.index - second.index)
		.map((item) => item.embedding)
}

/**
 * 重建 Milvus Collection。
 *
 * 为了保证每次运行 Demo 的结果干净一致，
 * 这里会先删除旧 Collection，再重新创建一个新的 Collection。
 *
 * 这个 Collection 同时支持两种检索能力：
 * 1. embedding 字段：Dense 向量检索
 * 2. sparse_embedding 字段：BM25 全文检索
 *
 * @param {MilvusClient} client Milvus 客户端。
 * @returns {Promise<void>}
 */
async function recreateCollection(client) {
	const exists = await client.hasCollection({
		collection_name: collectionName
	})

	if (exists.value) {
		await client.dropCollection({ collection_name: collectionName })
	}

	const result = await client.createCollection({
		collection_name: collectionName,

		fields: [
			{
				// 文档 ID，作为主键。
				name: 'id',
				data_type: DataType.VarChar,
				is_primary_key: true,
				max_length: 128
			},
			{
				// 文档标题，用来展示检索结果。
				name: 'title',
				data_type: DataType.VarChar,
				max_length: 256
			},
			{
				// 文档正文。
				// 这个字段既用于展示，也用于 BM25 全文检索。
				name: 'content',
				data_type: DataType.VarChar,
				max_length: 1024,

				// 开启 Analyzer，Milvus 才能对文本做分词。
				enable_analyzer: true,

				// 开启 match 能力，便于文本字段参与全文检索能力。
				enable_match: true,

				// 中文场景下使用 jieba 分词，并移除标点符号。
				analyzer_params: {
					tokenizer: 'jieba',
					filter: ['removepunct']
				}
			},
			{
				// 稠密向量字段。
				// 这个字段存储智谱 Embedding API 生成的向量。
				name: 'embedding',
				data_type: DataType.FloatVector,
				dim: dimensions
			},
			{
				// 稀疏向量字段。
				// 这个字段不需要手动写入，
				// 后面的 BM25 Function 会根据 content 自动生成它。
				name: 'sparse_embedding',
				data_type: DataType.SparseFloatVector
			}
		],

		functions: [
			{
				// BM25 Function：
				// 输入 content，输出 sparse_embedding。
				name: 'content_bm25',
				type: FunctionType.BM25,
				input_field_names: ['content'],
				output_field_names: ['sparse_embedding'],
				params: {}
			}
		],

		index_params: [
			{
				// embedding 字段用于 Dense 向量检索。
				// AUTOINDEX 表示让 Milvus 自动选择合适的向量索引。
				// COSINE 表示使用余弦相似度计算向量相似度。
				field_name: 'embedding',
				index_type: IndexType.AUTOINDEX,
				metric_type: MetricType.COSINE
			},
			{
				// sparse_embedding 字段用于 BM25 全文检索。
				// SPARSE_INVERTED_INDEX 是稀疏向量倒排索引。
				// BM25 表示使用 BM25 相关性分数。
				field_name: 'sparse_embedding',
				index_type: IndexType.SPARSE_INVERTED_INDEX,
				metric_type: MetricType.BM25,
				params: {
					// 倒排索引检索算法。
					inverted_index_algo: 'DAAT_MAXSCORE',

					// k1 控制词频对分数的影响。
					bm25_k1: 1.2,

					// b 控制文档长度归一化对分数的影响。
					bm25_b: 0.75
				}
			}
		]
	})

	ensureOk(result, '创建 Collection')
}

/**
 * 把测试文档写入 Milvus。
 *
 * 写入前会先为每篇文档的 content 生成 Dense 向量。
 * 插入时只需要写入 id、title、content、embedding。
 *
 * sparse_embedding 不需要手动写入，
 * 因为它会由 Collection 中配置的 BM25 Function 自动生成。
 *
 * @param {MilvusClient} client Milvus 客户端。
 * @returns {Promise<void>}
 */
async function insertDocuments(client) {
	const embeddings = await createEmbeddings(
		documents.map((document) => document.content)
	)

	const result = await client.insert({
		collection_name: collectionName,
		data: documents.map((document, index) => ({
			...document,
			embedding: embeddings[index]
		}))
	})

	ensureOk(result, '写入文档')

	// flushSync 会等待数据真正写入存储层。
	await client.flushSync({ collection_names: [collectionName] })

	// loadCollection 会把 Collection 加载到内存中，
	// 这样后续才能进行搜索。
	await client.loadCollection({ collection_name: collectionName })
}

/**
 * 执行 Dense 向量检索。
 *
 * 这个函数只搜索 embedding 字段。
 * 适合处理“表达方式不同，但语义相近”的问题。
 *
 * @param {MilvusClient} client Milvus 客户端。
 * @param {number[]} queryVector 用户问题生成的向量。
 * @param {number} limit 返回结果数量。
 * @returns {Promise<object[]>} 检索结果列表。
 */
async function denseSearch(client, queryVector, limit) {
	const result = await client.search({
		collection_name: collectionName,
		anns_field: 'embedding',
		data: [queryVector],
		limit,
		output_fields: ['id', 'title', 'content']
	})

	return result.results
}

/**
 * 执行 BM25 全文检索。
 *
 * 这个函数只搜索 sparse_embedding 字段。
 * 适合处理规则编号、关键词、专有名词、数字等精确匹配场景。
 *
 * @param {MilvusClient} client Milvus 客户端。
 * @param {string} question 用户原始问题文本。
 * @param {number} limit 返回结果数量。
 * @returns {Promise<object[]>} 检索结果列表。
 */
async function bm25Search(client, question, limit) {
	const result = await client.search({
		collection_name: collectionName,
		anns_field: 'sparse_embedding',

		// 这里传入原始文本即可。
		// Milvus 会基于 Analyzer 和 BM25 Function 完成全文检索。
		data: [question],
		limit,
		output_fields: ['id', 'title', 'content']
	})

	return result.results
}

/**
 * 创建一个归一化加权融合排序器。
 *
 * weights 表示每一路检索结果的权重。
 * 例如 [0.8, 0.2] 表示：
 * - Dense 向量检索权重 0.8
 * - BM25 全文检索权重 0.2
 *
 * norm_score: true 表示开启分数归一化。
 * 因为 Dense 和 BM25 的分数体系不同，直接加权会不公平。
 *
 * @param {number[]} weights 不同检索路线的融合权重。
 * @returns {object} Milvus hybridSearch 使用的 Weighted Reranker 配置。
 */
function normalizedWeightedRanker(weights) {
	return {
		name: 'normalized_weighted_ranker',
		type: FunctionType.RERANK,
		input_field_names: [],
		output_field_names: [],
		params: {
			reranker: 'weighted',
			weights,
			norm_score: true
		}
	}
}

/**
 * 执行混合检索。
 *
 * 这个函数会同时执行两路召回：
 * 1. embedding 字段上的 Dense 向量检索
 * 2. sparse_embedding 字段上的 BM25 全文检索
 *
 * 两路结果会先各自召回 Top5，
 * 然后通过 rerank 参数指定的方式进行融合排序，
 * 最终只返回 Top3。
 *
 * @param {MilvusClient} client Milvus 客户端。
 * @param {string} question 用户原始问题文本，用于 BM25 检索。
 * @param {number[]} queryVector 用户问题向量，用于 Dense 检索。
 * @param {object} rerank 融合排序器，可以是 Weighted 或 RRF。
 * @returns {Promise<object[]>} 混合检索结果列表。
 */
async function hybridSearch(client, question, queryVector, rerank) {
	const result = await client.hybridSearch({
		collection_name: collectionName,
		data: [
			{
				// 第一路：Dense 向量检索。
				anns_field: 'embedding',
				data: queryVector,
				limit: ROUTE_TOP_K
			},
			{
				// 第二路：BM25 全文检索。
				anns_field: 'sparse_embedding',
				data: question,
				limit: ROUTE_TOP_K
			}
		],
		rerank,
		limit: FINAL_TOP_K,
		output_fields: ['id', 'title', 'content']
	})

	return result.results
}

/**
 * 计算 Recall@K。
 *
 * 在这份代码中，K 就是 FINAL_TOP_K，也就是 3。
 *
 * 公式：
 * Recall@3 = Top3 中命中的标准答案数量 / 标准答案总数量
 *
 * @param {object[]} results 当前检索方式返回的 TopK 结果。
 * @param {string[]} relevantIds 人工标注的标准答案 ID 列表。
 * @returns {number} 当前检索结果的召回率。
 */
function recallAtK(results, relevantIds) {
	const resultIds = new Set(results.map((item) => item.id))
	const hitCount = relevantIds.filter((id) => resultIds.has(id)).length
	return hitCount / relevantIds.length
}

/**
 * 打印当前问题的标准答案文档。
 *
 * relevantIds 里保存的是人工标注的正确文档 ID。
 * 这里根据 ID 找到完整文档，并打印 id、title、content，
 * 方便学生对照后面的检索结果。
 *
 * @param {string[]} relevantIds 当前问题的标准答案 ID 列表。
 */
function printExpectedDocuments(relevantIds) {
	const documentMap = new Map(
		documents.map((document) => [document.id, document])
	)

	console.log('\n标准答案：')
	console.table(
		relevantIds.map((id) => {
			const document = documentMap.get(id)

			return {
				id: document.id,
				title: document.title,

				// content 可能比较长，也包含换行。
				// 为了让表格更清晰，这里去掉换行，并只展示前 60 个字符。
				content: document.content.replaceAll('\n', ' ').slice(0, 60)
			}
		})
	)
}

/**
 * 打印某一种检索方式的详细结果。
 *
 * 这里会展示：
 * - rank：当前结果排名
 * - hit：是否命中标准答案
 * - score：Milvus 返回的相关性分数
 * - id：文档 ID
 * - title：文档标题
 * - content：文档内容前 60 个字符
 *
 * @param {object} route 当前检索路线，例如 Dense、BM25、Weighted 或 RRF。
 * @param {string[]} relevantIds 当前问题的标准答案 ID 列表。
 */
function printSearchResults(route, relevantIds) {
	const relevantIdSet = new Set(relevantIds)
	const recall = recallAtK(route.results, relevantIds).toFixed(2)

	console.log(`\n${route.name}，Recall@${FINAL_TOP_K}=${recall}`)
	console.table(
		route.results.map((item, index) => ({
			rank: index + 1,
			hit: relevantIdSet.has(item.id) ? 'YES' : '',
			score: Number(item.score).toFixed(6),
			id: item.id,
			title: item.title,
			content: String(item.content).replaceAll('\n', ' ').slice(0, 60)
		}))
	)
}

/**
 * 评估单个测试问题。
 *
 * 一个问题会分别执行四种检索方式：
 * 1. Dense 向量检索
 * 2. BM25 全文检索
 * 3. Weighted 混合检索
 * 4. RRF 混合检索
 *
 * 最后会打印每种方式的详细召回结果，
 * 并返回每种方法在当前问题上的 Recall@3。
 *
 * @param {MilvusClient} client Milvus 客户端。
 * @param {object} evaluationCase 当前测试用例。
 * @returns {Promise<object>} 当前问题下四种检索方式的 Recall 结果。
 */
async function evaluateCase(client, evaluationCase) {
	const [queryVector] = await createEmbeddings([evaluationCase.question])

	const denseResults = await denseSearch(client, queryVector, FINAL_TOP_K)

	const bm25Results = await bm25Search(
		client,
		evaluationCase.question,
		FINAL_TOP_K
	)

	const weightedResults = await hybridSearch(
		client,
		evaluationCase.question,
		queryVector,
		normalizedWeightedRanker([0.8, 0.2])
	)

	const rrfResults = await hybridSearch(
		client,
		evaluationCase.question,
		queryVector,
		RRFRanker(60)
	)

	const routes = [
		{ key: 'Dense', name: METHOD_NAMES.Dense, results: denseResults },
		{ key: 'BM25', name: METHOD_NAMES.BM25, results: bm25Results },
		{
			key: 'Weighted',
			name: METHOD_NAMES.Weighted,
			results: weightedResults
		},
		{ key: 'RRF', name: METHOD_NAMES.RRF, results: rrfResults }
	]

	console.log(`\n\n================ ${evaluationCase.name} ================`)
	console.log(`输入：${evaluationCase.question}`)

	printExpectedDocuments(evaluationCase.relevantIds)

	for (const route of routes) {
		printSearchResults(route, evaluationCase.relevantIds)
	}

	console.log('\n本题结果汇总：')
	console.table(
		routes.map((route) => ({
			method: route.name,
			results: route.results.map((item) => item.title).join(' -> '),
			[`Recall@${FINAL_TOP_K}`]: recallAtK(
				route.results,
				evaluationCase.relevantIds
			).toFixed(2)
		}))
	)

	return Object.fromEntries(
		routes.map((route) => [
			route.key,
			recallAtK(route.results, evaluationCase.relevantIds)
		])
	)
}

/**
 * 主函数。
 *
 * 负责串起整个 Demo：
 * 1. 连接 Milvus
 * 2. 重建 Collection
 * 3. 写入测试文档
 * 4. 逐个执行测试问题
 * 5. 对比 Dense、BM25、Weighted、RRF 的 Recall@3
 * 6. 输出整体平均 Recall@3
 *
 * @returns {Promise<void>}
 */
async function main() {
	const client = await connectMilvus()

	try {
		await recreateCollection(client)
		await insertDocuments(client)

		console.log(`Collection：${collectionName}`)
		console.log(`文档数量：${documents.length}`)
		console.log(
			`统一评估条件：单路 Top${FINAL_TOP_K}；混合检索每路 Top${ROUTE_TOP_K}，最终 Top${FINAL_TOP_K}`
		)

		// 用来累计每种检索方式在所有测试问题上的 Recall。
		const totals = {
			Dense: 0,
			BM25: 0,
			Weighted: 0,
			RRF: 0
		}

		for (const evaluationCase of evaluationCases) {
			const recalls = await evaluateCase(client, evaluationCase)

			for (const method of Object.keys(totals)) {
				totals[method] += recalls[method]
			}
		}

		console.log('\n整体评估结果：')
		console.table(
			Object.entries(totals).map(([method, total]) => ({
				method: METHOD_NAMES[method],
				[`平均 Recall@${FINAL_TOP_K}`]: (
					total / evaluationCases.length
				).toFixed(2)
			}))
		)
	} finally {
		// 无论前面是否出错，最后都关闭 Milvus 连接。
		await client.closeConnection()
	}
}

// 执行主函数。
await main()
