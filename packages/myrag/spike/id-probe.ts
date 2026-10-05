/**
 * 探测 Zvec doc id 的合法字符集与长度边界。
 *
 * 背景：spike 里用 `${source}:v1:001` 作为 id 时报
 *   InvalidArgumentError: contains invalid characters
 * 需要确定到底哪些字符能用，才能设计 chunkId 格式。
 *
 * 运行：tsx spike/id-probe.ts
 */
import { rmSync, existsSync } from 'node:fs'
import {
  ZVecCreateAndOpen,
  ZVecCollectionSchema,
  ZVecDataType,
  ZVecIndexType,
  ZVecMetricType,
} from '@zvec/zvec'

const DIR = new URL('./zvec-data/id_probe', import.meta.url).pathname.replace(/^\//, '')

if (existsSync(DIR)) rmSync(DIR, { recursive: true, force: true })

const schema = new ZVecCollectionSchema({
  name: 'id_probe',
  vectors: [
    {
      name: 'embedding',
      dataType: ZVecDataType.VECTOR_FP32,
      dimension: 8,
      indexParams: { indexType: ZVecIndexType.FLAT, metricType: ZVecMetricType.COSINE },
    },
  ],
  fields: [{ name: 'content', dataType: ZVecDataType.STRING }],
})

const collection = ZVecCreateAndOpen(DIR, schema)

// 确定性伪随机向量，避免调用 embedding API
function vec(seed: number) {
  const v = new Array(8)
  for (let i = 0; i < 8; i++) v[i] = Math.sin(seed * (i + 1))
  return v
}

const candidates: Array<[string, string]> = [
  ['冒号', 'ast:v1:001'],
  ['连字符', 'ast-v1-001'],
  ['下划线', 'ast_v1_001'],
  ['点号', 'ast.v1.001'],
  ['斜杠', 'ast/v1/001'],
  ['反斜杠', 'ast\\v1\\001'],
  ['空格', 'ast v1 001'],
  ['井号', 'ast#v1#001'],
  ['at 符号', 'ast@v1@001'],
  ['加号', 'ast+v1+001'],
  ['中文', '类型文档-001'],
  ['纯字母数字', 'ASTv1001'],
  ['典型带哈希', 'ast-v1-001-a1b2c3d4e5f6'],
  ['长度 31', 'a'.repeat(31)],
  ['长度 32', 'b'.repeat(32)],
  ['长度 63', 'c'.repeat(63)],
  ['长度 64', 'd'.repeat(64)],
  ['长度 65', 'e'.repeat(65)],
  ['长度 100', 'f'.repeat(100)],
  ['长度 127', 'g'.repeat(127)],
  ['长度 128', 'h'.repeat(128)],
  ['等号', 'ast=v1=001'],
  ['百分号', 'ast%v1%001'],
  ['美元符', 'ast$v1$001'],
]

console.log('id 候选探测（✓ = 接受，✗ = 拒绝）')
console.log('='.repeat(72))

let ok = 0
for (const [label, id] of candidates) {
  let result: string
  try {
    collection.insertSync({ id, vectors: { embedding: vec(id.length) }, fields: { content: 'x' } })
    result = '✓ 接受'
    ok++
  } catch (e: any) {
    const msg = String(e?.message ?? e).replace(/^Error[^:]*:\s*/, '')
    result = `✗ ${msg.slice(0, 90)}`
  }
  const shown = id.length > 24 ? `${id.slice(0, 12)}…(${id.length}字符)` : id
  console.log(`  ${label.padEnd(10)} ${shown.padEnd(26)} ${result}`)
}

console.log('')
console.log(`接受 ${ok} / ${candidates.length}`)
console.log(`最终 docCount = ${collection.stats.docCount}`)

collection.closeSync()
console.log('closeSync ✓')
