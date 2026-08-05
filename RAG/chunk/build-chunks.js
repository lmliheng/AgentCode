import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

// 原始 Markdown 文档所在目录。
// 程序会读取 documents 目录下的所有 .md 文件。
const documentDir = path.join(process.cwd(), 'documents')

// 切块结果输出目录。
const outputDir = path.join(process.cwd(), 'output')

// 最终生成的 Chunk 数据文件。
const outputFile = path.join(outputDir, 'chunks.json')

// 每个 Chunk 的最大长度，默认 120 个字符。
// 真实项目中一般会按 Token 数量控制，这里为了演示，先按字符数控制。
const chunkMaxLength = 120

// Chunk 之间的重叠长度，默认 40 个字符。
// overlap 可以减少上下文被切断的问题。
const chunkOverlapLength = 40

/**
 * 计算文本的 sha256 哈希值。
 *
 * 这里主要用于生成 contentHash，
 * 方便判断 Chunk 内容是否发生变化。
 */
function sha256(text) {
	return createHash('sha256').update(text).digest('hex')
}

/**
 * 对原始文本做基础清洗。
 *
 * 主要处理：
 * 1. 统一换行符
 * 2. 替换 tab
 * 3. 合并多余空格
 * 4. 合并过多空行
 * 5. 去掉首尾空白
 */
function normalizeText(text) {
	return text
		.replace(/\r\n/g, '\n')
		.replace(/\t/g, ' ')
		.replace(/[ ]{2,}/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
}

/**
 * 从 Markdown 文档里读取简单的元信息。
 *
 * 例如：
 * category: after-sales
 * owner: customer-service
 * version: v1
 *
 * 如果没有读取到，就使用 fallback 默认值。
 */
function readMetaLine(lines, name, fallback) {
	const line = lines.find((item) => item.startsWith(`${name}:`))

	if (!line) {
		return fallback
	}

	return line.replace(`${name}:`, '').trim()
}

/**
 * 解析 Markdown 文档。
 *
 * 这一步会从原始 Markdown 中提取：
 * - 文件名
 * - 标题
 * - category
 * - owner
 * - version
 * - 正文内容
 */
function parseMarkdown({ fileName, rawText }) {
	const normalizedText = normalizeText(rawText)
	const lines = normalizedText.split('\n')

	// 默认把一级标题作为文档标题。
	// 如果文档里没有一级标题，就使用文件名作为标题。
	const titleLine = lines.find((line) => line.startsWith('# '))
	const title = titleLine?.replace(/^#\s+/, '').trim() ?? fileName

	// 从文档中读取 Metadata。
	const category = readMetaLine(lines, 'category', 'unknown')
	const owner = readMetaLine(lines, 'owner', 'unknown')
	const sourceVersion = readMetaLine(lines, 'version', 'v1')

	// 正文中不再保留 category / owner / version 这些元信息行。
	// 这些信息会被放到 metadata 字段里。
	const body = lines
		.filter((line) => !line.startsWith('category:'))
		.filter((line) => !line.startsWith('owner:'))
		.filter((line) => !line.startsWith('version:'))
		.join('\n')

	return {
		fileName,
		title,
		category,
		owner,
		sourceVersion,
		text: normalizeText(body)
	}
}

/**
 * 处理超长段落。
 *
 * 如果某个段落本身已经超过 chunkMaxLength，
 * 就只能按照固定长度继续切成多个小片段。
 */
function splitLongParagraph(paragraph) {
	const parts = []

	for (let start = 0; start < paragraph.length; start += chunkMaxLength) {
		parts.push(paragraph.slice(start, start + chunkMaxLength).trim())
	}

	return parts.filter(Boolean)
}

/**
 * 把文档正文拆成段落数组。
 *
 * 规则：
 * - 先按空行拆分段落
 * - 段落内部的换行替换成空格
 * - 过滤空段落
 * - 如果段落太长，再继续切小
 */
function splitIntoParagraphs(text) {
	return text
		.split(/\n\s*\n/)
		.map((paragraph) => paragraph.replace(/\n/g, ' ').trim())
		.filter(Boolean)
		.flatMap((paragraph) => {
			if (paragraph.length <= chunkMaxLength) {
				return [paragraph]
			}

			return splitLongParagraph(paragraph)
		})
}

/**
 * 从当前 Chunk 末尾取一段文本作为 overlap。
 *
 * overlap 的作用是：
 * 让相邻 Chunk 之间保留一点重复内容，
 * 避免重要语义刚好被切断。
 */
function takeOverlap(text) {
	if (chunkOverlapLength <= 0) {
		return ''
	}

	return text.slice(-chunkOverlapLength).trim()
}

/**
 * 生成稳定的 Chunk ID。
 *
 * Chunk ID 中包含：
 * - 来源文件名
 * - 来源版本
 * - Chunk 序号
 * - 内容哈希
 *
 * 这样做的好处是：
 * 当文档内容或版本变化时，可以更容易识别哪些 Chunk 发生了变化。
 */
function toChunkId({ fileName, sourceVersion, chunkIndex, content }) {
	const sourceName = fileName.replace(/\.md$/, '')
	const contentHash = sha256(content).slice(0, 12)
	const indexText = String(chunkIndex).padStart(3, '0')

	return `${sourceName}:${sourceVersion}:${indexText}:${contentHash}`
}

/**
 * 把一份文档切成多个 Chunk。
 *
 * 整体流程：
 * 1. 先把正文拆成段落
 * 2. 尽量把多个段落合并成一个 Chunk
 * 3. 如果超过最大长度，就结束当前 Chunk
 * 4. 新 Chunk 开头带上一点 overlap
 * 5. 最后为每个 Chunk 补充 metadata
 */
function createChunks(document) {
	const paragraphs = splitIntoParagraphs(document.text)

	const chunks = []
	let current = []

	for (const paragraph of paragraphs) {
		// 尝试把当前段落加入正在构建的 Chunk。
		const nextText = [...current, paragraph].join('\n\n')

		// 如果加入后超过最大长度，就先保存当前 Chunk。
		if (current.length > 0 && nextText.length > chunkMaxLength) {
			const content = current.join('\n\n')
			chunks.push(content)

			// 从上一个 Chunk 的末尾取一小段作为下一个 Chunk 的开头。
			const overlap = takeOverlap(content)
			current = overlap ? [overlap, paragraph] : [paragraph]
			continue
		}

		current.push(paragraph)
	}

	// 循环结束后，如果还有未保存的内容，需要补上最后一个 Chunk。
	if (current.length > 0) {
		chunks.push(current.join('\n\n'))
	}

	// 把普通字符串 Chunk 转成结构化数据。
	return chunks.map((content, index) => {
		const chunkIndex = index + 1
		const contentHash = sha256(content).slice(0, 12)

		return {
			chunkId: toChunkId({
				fileName: document.fileName,
				sourceVersion: document.sourceVersion,
				chunkIndex,
				content
			}),

			// Chunk 的正文内容。
			// 后续会对这个 content 做 Embedding。
			content,

			// Chunk 的元信息。
			// 后续检索、过滤、展示来源、版本更新都会用到这些信息。
			metadata: {
				source: document.fileName,
				title: document.title,
				category: document.category,
				owner: document.owner,
				sourceVersion: document.sourceVersion,
				chunkIndex,
				contentHash,
				chunkLength: content.length
			}
		}
	})
}

/**
 * 从 documents 目录中加载所有 Markdown 文档。
 *
 * 这里只处理 .md 文件，并且按照文件名排序，
 * 这样每次运行时的处理顺序更稳定。
 */
async function loadMarkdownDocuments() {
	const entries = await readdir(documentDir, { withFileTypes: true })

	const markdownFiles = entries
		.filter((entry) => entry.isFile())
		.filter((entry) => entry.name.endsWith('.md'))
		.map((entry) => entry.name)
		.sort()

	const documents = []

	for (const fileName of markdownFiles) {
		const filePath = path.join(documentDir, fileName)
		const rawText = await readFile(filePath, 'utf8')

		// 读取文件后，立刻解析成统一的文档结构。
		documents.push(parseMarkdown({ fileName, rawText }))
	}

	return documents
}

async function main() {
	// 基础参数校验。
	if (chunkMaxLength <= 0) {
		throw new Error('CHUNK_MAX_LENGTH 必须大于 0。')
	}

	if (chunkOverlapLength < 0) {
		throw new Error('CHUNK_OVERLAP_LENGTH 不能小于 0。')
	}

	// 读取 Markdown 文档。
	const documents = await loadMarkdownDocuments()

	// 对每份文档进行切块。
	// flatMap 会把多份文档生成的 Chunk 合并成一个数组。
	const chunks = documents.flatMap(createChunks)

	// 确保 output 目录存在。
	await mkdir(outputDir, { recursive: true })

	// 把切块结果写入 chunks.json。
	// 后续可以继续读取这个文件，再做 Embedding 和入库。
	await writeFile(outputFile, JSON.stringify(chunks, null, 2), 'utf8')

	console.log(`文档数量：${documents.length}`)
	console.log(`Chunk 数量：${chunks.length}`)
	console.log(`已写入：${outputFile}`)

	console.log('\n前 3 个 Chunk：')

	// 打印前 3 个 Chunk 的核心信息，方便快速检查切块结果。
	console.table(
		chunks.slice(0, 3).map((chunk) => ({
			chunkId: chunk.chunkId,
			title: chunk.metadata.title,
			category: chunk.metadata.category,
			version: chunk.metadata.sourceVersion,
			length: chunk.metadata.chunkLength
		}))
	)
}

main()
