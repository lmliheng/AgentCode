/**
 * 校验已入库的数据是否可查、字段是否正确落地。
 *
 * 只做 FTS 检索（jieba 中文分词），不需要调用 embedding 接口，因此不消耗 API 额度。
 *
 * 运行：tsx spike/query-probe.ts <collection 目录> [检索词...]
 * 例：  tsx spike/query-probe.ts ./spike/zvec-data/ingest-test 奖学金 退款
 */
import { resolve } from 'node:path'
import { ZVecOpen } from '@zvec/zvec'

const [dbPath, ...terms] = process.argv.slice(2)
if (!dbPath) {
    console.error('用法：tsx spike/query-probe.ts <collection 目录> [检索词...]')
    process.exit(1)
}

const collection = ZVecOpen(resolve(dbPath))

console.log(`collection：${resolve(dbPath)}`)
console.log(`文档数：${collection.stats.docCount}`)

const vectorField = collection.schema.vectors().find((vector) => vector.name === 'embedding')
console.log(`向量字段：embedding　维度=${vectorField?.dimension ?? '?'}　dataType=${vectorField?.dataType ?? '?'}`)
console.log(`标量字段：${collection.schema.fields().map((field) => field.name).join(', ')}`)
console.log('')

const queries = terms.length > 0 ? terms : ['数据']

for (const term of queries) {
    console.log(`=== FTS 检索「${term}」===`)
    let docs
    try {
        docs = collection.querySync({
            fieldName: 'content',
            fts: { matchString: term },
            topk: 3,
            outputFields: ['source', 'scope', 'heading', 'kind', 'category', 'chunkIndex', 'pageNumbers'],
        })
    } catch (error) {
        console.log(`  检索失败：${(error as Error).message.split('\n')[0]}`)
        console.log('')
        continue
    }

    if (docs.length === 0) {
        console.log('  无命中')
        console.log('')
        continue
    }

    for (const doc of docs) {
        const preview = String(doc.fields.content ?? '').replace(/\s+/g, ' ').slice(0, 70)
        console.log(`  score=${doc.score.toFixed(4)}  id=${doc.id}`)
        console.log(
            `    source=${doc.fields.source}　kind=${doc.fields.kind}　category=${doc.fields.category}　` +
                `chunkIndex=${doc.fields.chunkIndex}　pages=${JSON.stringify(doc.fields.pageNumbers)}`
        )
        console.log(`    scope=${JSON.stringify(doc.fields.scope ?? null)}　heading=${JSON.stringify(doc.fields.heading ?? null)}`)
        console.log(`    ${preview}...`)
    }
    console.log('')
}

// 取回一条完整文档，确认字段落地情况（尤其可空字段是「省略」而不是 null）
const sample = collection.querySync({
    fieldName: 'content',
    fts: { matchString: queries[0] ?? '数据' },
    topk: 1,
})
const first = sample[0]
if (first) {
    console.log('=== 一条文档的完整字段（验证可空字段确实被省略）===')
    const fetched = collection.fetchSync({ ids: [first.id], includeVector: false })
    const doc = fetched[first.id]
    console.log(`  id = ${first.id}`)
    console.log(`  fields = ${JSON.stringify(doc?.fields, null, 2)}`)
}

collection.closeSync()
