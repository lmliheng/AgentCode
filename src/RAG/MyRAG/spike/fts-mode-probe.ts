/**
 * 对比 FTS 的两种查询写法：matchString vs queryString。
 *
 * 动机：评测里 3 条失败 query 有个共同点 —— 都是长自然语言问句
 * （「怎么判断一个变量的具体类型」「实习报告里探测的目标体有哪些」「这个人的项目经历是什么」），
 * 而短问句（「柯里化是怎么实现的」）用 FTS 都能命中。
 * 怀疑 matchString 要求所有词项都命中（AND 语义），长问句必然失败。
 *
 * 运行：tsx spike/fts-mode-probe.ts
 */
import { resolve } from 'node:path'
import { ZVecOpen } from '@zvec/zvec'
import { QUERY_OUTPUT_FIELDS } from '../src/query/index.js'

const DB = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/MyRAG/zvec-data/myrag'

interface Case {
    question: string
    expect: string
}

const CASES: Case[] = [
    { question: '怎么判断一个变量的具体类型', expect: 'typings/typeGuard.md' },
    { question: '实习报告里探测的目标体有哪些', expect: '报告.docx' },
    { question: '柯里化是怎么实现的', expect: 'tips/curry.md' },
    { question: '柯里化', expect: 'tips/curry.md' },
]

const collection = ZVecOpen(resolve(DB))

function top3(field: 'matchString' | 'queryString', question: string): { count: number; sources: string[] } {
    try {
        const docs = collection.querySync(
            field === 'matchString'
                ? { fieldName: 'content', fts: { matchString: question }, topk: 100, outputFields: QUERY_OUTPUT_FIELDS }
                : { fieldName: 'content', fts: { queryString: question }, topk: 100, outputFields: QUERY_OUTPUT_FIELDS }
        )
        return { count: docs.length, sources: docs.slice(0, 3).map((doc) => String(doc.fields.source ?? '')) }
    } catch (error) {
        const message = (error as Error).message.split('\n')[0] ?? ''
        return { count: -1, sources: [`(报错: ${message.slice(0, 70)})`] }
    }
}

console.log('| 问句 | 期望来源 | matchString 命中数 / Top3 | queryString 命中数 / Top3 |')
console.log('|---|---|---|---|')

for (const item of CASES) {
    const match = top3('matchString', item.question)
    const query = top3('queryString', item.question)
    console.log(
        `| ${item.question} | ${item.expect} | ${match.count} / ${match.sources.join(', ')} | ${query.count} / ${query.sources.join(', ')} |`
    )
}

console.log('')
console.log('另一种思路：把长问句拆成关键词后再用 matchString')
for (const item of CASES) {
    // 极简关键词抽取：去停用词与疑问词，只留 2 字以上的连续片段
    const keywords = item.question
        .replace(/[？?。，,、！!是的是怎么有哪些什么吗呢了一个]/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length >= 2)
        .slice(0, 3)
    for (const keyword of keywords) {
        const result = top3('matchString', keyword)
        const hit = result.sources.includes(item.expect)
        console.log(`  「${item.question}」→ 关键词「${keyword}」：命中 ${result.count} 条，Top1=${result.sources[0] ?? '-'} ${hit ? '✅' : ''}`)
    }
    console.log('')
}

collection.closeSync()
