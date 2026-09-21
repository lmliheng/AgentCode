/**
 * M4 Spike：验证 Zvec 能否替代 Milvus 承担 MyRAG 的存储与混合检索。
 *
 * 验证项：
 *   1. schema 能否声明 dense(1024) + FTS(jieba) + 标量字段
 *   2. 中文 FTS 是否真的能分词检索
 *   3. multiQuery 的 rrf / weighted 两种 rerank 是否可用
 *   4. 标量 filter 是否可用
 *   5. upsertSync 幂等重灌是否成立（docCount 不翻倍）
 *   6. deleteByFilterSync 是否可用
 *
 * 运行：
 *   tsx --env-file=../rag-chunk/.env spike/zvec-spike.ts
 */
import { readFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  ZVecCreateAndOpen,
  ZVecOpen,
  ZVecCollectionSchema,
  ZVecDataType,
  ZVecIndexType,
  ZVecMetricType,
} from '@zvec/zvec'

const DATA_DIR = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/Milvus/data'
const COLLECTION_DIR = new URL('./zvec-data/myrag_spike', import.meta.url).pathname.replace(/^\//, '')
const DIM = 1024

const KEY = process.env.Z_API_KEY
if (!KEY) throw new Error('缺少 Z_API_KEY，请用 --env-file 指定 .env')

// ---------------------------------------------------------------- 测试语料

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.md$/i.test(e.name)) out.push(p)
  }
  return out
}

/** 粗略按 H2 切出 section，只为给 spike 提供真实语料，不是最终分块实现。 */
function crudeSections(md: string) {
  return md
    .split(/\n(?=## )/)
    .map((s) => s.trim())
    .filter((s) => s.length > 60 && s.length <= 3600)
}

/**
 * 生成 Zvec doc id。
 *
 * 实测约束（见 spike/id-probe.ts）：
 *   - 只允许 ASCII 字母数字和 - _ . # @ + = % $
 *   - 最大 64 字符（65 即报 "invalid characters"）
 * 所以这里把来源名截断到 32 字符，且用 - 而不是 : 作分隔符。
 * 最坏长度 = 32 + 1 + 2 + 1 + 3 + 1 + 12 = 52。
 */
function makeId(source: string, version: string, index: number, content: string) {
  const base = source
    .replace(/\.md$/i, '')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .slice(0, 32)
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12)
  return `${base}-${version}-${String(index).padStart(3, '0')}-${hash}`
}

interface Sample {
  id: string
  content: string
  source: string
  title: string
  category: string
  owner: string
  sourceVersion: string
  chunkIndex: number
  chunkLength: number
  scope: string
}

const files = walk(DATA_DIR)
  .filter((f) => !f.includes('\\jsx\\') && !f.includes('/jsx/'))
  .slice(0, 4)

const samples: Sample[] = []
for (const f of files) {
  const md = readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
  const title = (md.match(/^#\s+(.+)$/m)?.[1] ?? 'untitled').trim()
  const source = f.split(/[\\/]/).pop()!
  crudeSections(md)
    .slice(0, 3)
    .forEach((content, i) => {
      samples.push({
        id: makeId(source, 'v1', i + 1, content),
        content,
        source,
        title,
        category: 'typescript-doc',
        owner: 'learning',
        sourceVersion: 'v1',
        chunkIndex: i + 1,
        chunkLength: content.length,
        scope: title,
      })
    })
}

console.log(`语料：${files.length} 篇文档 → ${samples.length} 个 chunk`)
console.log(`chunk 长度范围：${Math.min(...samples.map((s) => s.chunkLength))} ~ ${Math.max(...samples.map((s) => s.chunkLength))} 字符`)
console.log('')

// ---------------------------------------------------------------- embedding

async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: 'embedding-3', input: texts, dimensions: DIM }),
  })
  const body: any = await res.json()
  if (!res.ok) throw new Error(`embedding 失败 ${res.status}: ${JSON.stringify(body).slice(0, 300)}`)
  return body.data
    .sort((a: any, b: any) => a.index - b.index)
    .map((d: any) => d.embedding)
}

// ---------------------------------------------------------------- schema

const schema = new ZVecCollectionSchema({
  name: 'myrag_spike',
  vectors: [
    {
      name: 'embedding',
      dataType: ZVecDataType.VECTOR_FP32,
      dimension: DIM,
      indexParams: { indexType: ZVecIndexType.FLAT, metricType: ZVecMetricType.COSINE },
    },
  ],
  fields: [
    {
      name: 'content',
      dataType: ZVecDataType.STRING,
      indexParams: { indexType: ZVecIndexType.FTS, tokenizerName: 'jieba', filters: ['lowercase'] },
    },
    { name: 'source', dataType: ZVecDataType.STRING },
    { name: 'title', dataType: ZVecDataType.STRING },
    { name: 'category', dataType: ZVecDataType.STRING },
    { name: 'owner', dataType: ZVecDataType.STRING },
    { name: 'sourceVersion', dataType: ZVecDataType.STRING },
    { name: 'scope', dataType: ZVecDataType.STRING },
    { name: 'chunkIndex', dataType: ZVecDataType.INT64 },
    { name: 'chunkLength', dataType: ZVecDataType.INT64 },
  ],
})

console.log('schema 构造成功 ✓')
console.log(schema.toString())
console.log('')

// ---------------------------------------------------------------- 建库并灌数据

if (existsSync(COLLECTION_DIR)) {
  console.log(`清掉旧 spike 库：${COLLECTION_DIR}`)
  rmSync(COLLECTION_DIR, { recursive: true, force: true })
}

let collection = ZVecCreateAndOpen(COLLECTION_DIR, schema)
console.log(`collection 创建成功 ✓  path=${collection.path}`)

const vectors = await embed(samples.map((s) => s.content))
console.log(`embedding 完成 ✓  ${vectors.length} 条 × ${vectors[0]?.length ?? 0} 维`)
console.log('')

function toDoc(s: Sample, vector: number[]) {
  return {
    id: s.id,
    vectors: { embedding: vector },
    fields: {
      content: s.content,
      source: s.source,
      title: s.title,
      category: s.category,
      owner: s.owner,
      sourceVersion: s.sourceVersion,
      scope: s.scope,
      chunkIndex: s.chunkIndex,
      chunkLength: s.chunkLength,
    },
  }
}

const statuses = collection.insertSync(samples.map((s, i) => toDoc(s, vectors[i] ?? [])))
console.log(`insertSync ✓  返回 ${Array.isArray(statuses) ? statuses.length : 1} 个 status`)
console.log(`  首个 status: ${JSON.stringify(statuses[0] ?? statuses)}`)
console.log(`  docCount = ${collection.stats.docCount}`)
console.log('')

// ---------------------------------------------------------------- 幂等性

collection.upsertSync(samples.map((s, i) => toDoc(s, vectors[i] ?? [])))
console.log(`upsertSync 重灌同一批 ✓  docCount = ${collection.stats.docCount}（应与上面相同，不翻倍）`)
console.log('')

// ---------------------------------------------------------------- 查询

function show(label: string, docs: any[]) {
  console.log(`${label}  →  ${docs.length} 条`)
  for (const d of docs.slice(0, 3)) {
    const preview = String(d.fields?.content ?? '').replace(/\s+/g, ' ').slice(0, 60)
    console.log(`    score=${d.score.toFixed(4)}  id=${d.id}  scope=${d.fields?.scope ?? '-'}`)
    console.log(`      ${preview}...`)
  }
  console.log('')
}

const QUESTION = 'TypeScript 的类型有哪些'
console.log(`查询：${QUESTION}`)
console.log('='.repeat(70))
console.log('')

const qv = (await embed([QUESTION]))[0] ?? []

show('1) 纯向量（dense only）', collection.querySync({ fieldName: 'embedding', vector: qv, topk: 3 }))

show('2) 纯 FTS（jieba 中文分词）', collection.querySync({ fieldName: 'content', fts: { matchString: QUESTION }, topk: 3 }))

show('3) multiQuery + rrf（默认 rankConstant=60）', collection.multiQuerySync({
  queries: [
    { fieldName: 'embedding', vector: qv },
    { fieldName: 'content', fts: { matchString: QUESTION } },
  ],
  topk: 3,
}))

show('4) multiQuery + weighted [0.7, 0.3]', collection.multiQuerySync({
  queries: [
    { fieldName: 'embedding', vector: qv },
    { fieldName: 'content', fts: { matchString: QUESTION } },
  ],
  topk: 3,
  rerank: { type: 'weighted', weights: [0.7, 0.3] },
}))

// ---------------------------------------------------------------- filter

show(
  "5) 纯向量 + 标量 filter（category = 'typescript-doc'）",
  collection.querySync({
    fieldName: 'embedding',
    vector: qv,
    topk: 3,
    filter: "category = 'typescript-doc'",
  })
)

show(
  "6) 多值 filter（(owner = 'learning' OR owner = 'other')）",
  collection.querySync({
    fieldName: 'embedding',
    vector: qv,
    topk: 3,
    filter: "(owner = 'learning' OR owner = 'other')",
  })
)

show(
  "7) 数值比较 + AND（chunkIndex >= 1 AND chunkIndex < 3）",
  collection.querySync({
    fieldName: 'embedding',
    vector: qv,
    topk: 3,
    filter: 'chunkIndex >= 1 AND chunkIndex < 3',
  })
)

const filtered = collection.querySync({
  fieldName: 'embedding',
  vector: qv,
  topk: 3,
  filter: "category = 'no-such-category'",
})
console.log(`8) 不存在的 filter 值 → 返回 ${filtered.length} 条（应为 0，证明 filter 真的生效）`)
console.log('')

// ---------------------------------------------------------------- 按 id 取回

// spike 语料取自真实目录，samples 必然非空；?? '' 只是收窄类型
const firstId = samples[0]?.id ?? ''
const one = collection.fetchSync({ ids: [firstId], outputFields: ['source', 'scope'], includeVector: false })
console.log(`9) fetchSync ✓  ${JSON.stringify(one[firstId]?.fields ?? {})}`)
console.log('')

// ---------------------------------------------------------------- 删除

const beforeDelete = collection.stats.docCount
const delTarget = samples[0]?.source ?? ''
const delStatus = collection.deleteByFilterSync(`source = '${delTarget}'`)
console.log(`10) deleteByFilterSync ✓  ${JSON.stringify(delStatus)}`)
console.log(`    docCount: ${beforeDelete} → ${collection.stats.docCount}  （删掉 source='${delTarget}' 的 ${beforeDelete - collection.stats.docCount} 条）`)
console.log('')

collection.closeSync()
console.log('11) closeSync ✓')

// ---------------------------------------------------------------- 重开（持久化验证）

collection = ZVecOpen(COLLECTION_DIR)
console.log(`12) ZVecOpen 重开 ✓  docCount = ${collection.stats.docCount}（应等于关闭前的值，证明已落盘）`)
collection.closeSync()
console.log('')
console.log('SPIKE 全部完成')
