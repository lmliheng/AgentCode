/**
 * 为 ingest 的 schema 设计探明三个未验证的 Zvec 行为：
 *   1. nullable: true 的标量字段，能否省略、能否显式传 null
 *   2. ARRAY_INT64 字段存页码数组（含空数组）
 *   3. filter 是否支持 IN / NOT（决定「删除过期 chunk」能否用一条 filter 表达）
 *   4. 重开 collection 后能否读回 schema（用于校验维度是否与代码一致）
 *
 * 运行：tsx spike/schema-probe.ts
 */
import { rmSync, existsSync } from 'node:fs'
import {
    ZVecCreateAndOpen,
    ZVecOpen,
    ZVecCollectionSchema,
    ZVecDataType,
    ZVecIndexType,
    ZVecMetricType,
} from '@zvec/zvec'

const DIR = new URL('./zvec-data/schema_probe', import.meta.url).pathname.replace(/^\//, '')

if (existsSync(DIR)) {
    rmSync(DIR, { recursive: true, force: true })
}

const schema = new ZVecCollectionSchema({
    name: 'schema_probe',
    vectors: [
        {
            name: 'embedding',
            dataType: ZVecDataType.VECTOR_FP32,
            dimension: 8,
            indexParams: { indexType: ZVecIndexType.FLAT, metricType: ZVecMetricType.COSINE },
        },
    ],
    fields: [
        { name: 'content', dataType: ZVecDataType.STRING },
        { name: 'scope', dataType: ZVecDataType.STRING, nullable: true },
        { name: 'heading', dataType: ZVecDataType.STRING, nullable: true },
        { name: 'group', dataType: ZVecDataType.STRING, nullable: true },
        { name: 'headingLevel', dataType: ZVecDataType.INT64, nullable: true },
        { name: 'pageNumbers', dataType: ZVecDataType.ARRAY_INT64 },
    ],
})

let collection = ZVecCreateAndOpen(DIR, schema)

function vec(seed: number) {
    const v = new Array(8)
    for (let i = 0; i < 8; i++) v[i] = Math.sin(seed * (i + 1))
    return v
}

console.log('=== 1) nullable 字段：省略 vs 显式 null vs 有值 ===')
const cases: Array<{ label: string; id: string; fields: Record<string, unknown> }> = [
    { label: '有值', id: 'case-has-value', fields: { scope: 'A::B', headingLevel: 2 } },
    { label: '省略', id: 'case-omitted', fields: {} },
    { label: '显式 null', id: 'case-explicit-null', fields: { scope: null, headingLevel: null } },
]
for (const item of cases) {
    try {
        const status: any = collection.insertSync({
            id: item.id,
            vectors: { embedding: vec(1) },
            fields: { content: item.label, pageNumbers: [1], ...item.fields },
        })
        console.log(`  插入「${item.label}」: ${JSON.stringify(status)}`)
    } catch (error) {
        console.log(`  插入「${item.label}」失败: ${(error as Error).message.slice(0, 160)}`)
    }
}
console.log('')

console.log('=== 2) ARRAY_INT64 页码 ===')
const pageCases: Array<{ label: string; id: string; pages: number[] }> = [
    { label: '[1,2,3]', id: 'pages-full', pages: [1, 2, 3] },
    { label: '空数组', id: 'pages-empty', pages: [] },
]
for (const item of pageCases) {
    try {
        const status: any = collection.insertSync({
            id: item.id,
            vectors: { embedding: vec(2) },
            fields: { content: `pages ${item.label}`, pageNumbers: item.pages },
        })
        console.log(`  插入页码 ${item.label}: ${JSON.stringify(status)}`)
    } catch (error) {
        console.log(`  插入页码 ${item.label} 失败: ${(error as Error).message.slice(0, 160)}`)
    }
}
console.log('')

const fetched = collection.fetchSync({
    ids: ['case-has-value', 'case-omitted', 'pages-full', 'pages-empty'],
    includeVector: false,
})
console.log('=== 3) 取回结果（看省略/null/空数组实际存成了什么）===')
for (const [id, doc] of Object.entries(fetched)) {
    console.log(`  ${id}  fields=${JSON.stringify((doc as any).fields)}`)
}
console.log('')

console.log('=== 4) filter 语法：IN / NOT / 字符串相等 ===')
const filters = [
    "scope = 'A::B'",
    "scope IN ('A::B', 'X::Y')",
    'headingLevel = 2',
    "content = '省略' AND NOT scope = 'A::B'",
    'pageNumbers IN (1, 2)',
]
for (const filter of filters) {
    try {
        const docs = collection.querySync({ fieldName: 'embedding', vector: vec(1), topk: 10, filter })
        console.log(`  ✓ ${filter}  →  ${docs.length} 条`)
    } catch (error) {
        const message = (error as Error).message.split('\n')[0] ?? ''
        console.log(`  ✗ ${filter}  →  ${message.slice(0, 130)}`)
    }
}
console.log('')

collection.closeSync()
collection = ZVecOpen(DIR)

console.log('=== 5) 重开后读回 schema（用于校验维度一致性）===')
const vectors = collection.schema.vectors()
for (const vector of vectors) {
    console.log(`  向量字段 ${vector.name}: dataType=${vector.dataType} dimension=${vector.dimension}`)
}
console.log(`  docCount = ${collection.stats.docCount}`)
console.log(`  标量字段 = ${collection.schema.fields().map((field) => field.name).join(', ')}`)

collection.closeSync()
