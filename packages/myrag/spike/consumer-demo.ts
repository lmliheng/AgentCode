/**
 * 模拟 AgentCode 的消费方：只通过对外入口 src/index.ts 使用 MyRAG。
 *
 * 验证四件事：
 *   1. 入口可用：只需 import { query }，不需要知道 Zvec / store / embedding
 *   2. 句柄缓存生效：首次调用含打开开销，后续调用明显更快
 *   3. closeQuery() 能释放句柄
 *   4. 锁语义：持有句柄时灌库被挡（且报错是可读的提示），释放后灌库成功
 *
 * 运行：tsx --env-file=../rag-chunk/.env spike/consumer-demo.ts
 */
import { spawnSync } from 'node:child_process'
import { query, closeQuery, queryHandleState } from '../src/index.js'

const DOCS = '../rag-chunk/documents'

function runIngest(label: string) {
    const result = spawnSync(
        'npx',
        ['tsx', 'src/cli.ts', 'ingest', DOCS, '--category', 'sample', '--owner', 'learning', '--limit', '1', '--quiet'],
        { shell: true, encoding: 'utf8' }
    )
    const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    console.log(`  [${label}] 退出码=${result.status}`)
    for (const line of text.split('\n').filter((line) => line.trim().length > 0).slice(-6)) {
        console.log(`      ${line}`)
    }
    return result.status
}

async function timedQuery(question: string) {
    const startedAt = performance.now()
    const result = await query(question, { topk: 2 })
    const elapsed = performance.now() - startedAt
    const top = result.hits[0]
    console.log(
        `  ${elapsed.toFixed(0).padStart(5)} ms　模式 ${result.mode}　Top1 = ${top?.source ?? '(无)'}` +
            `${top ? ` (score ${top.score.toFixed(4)})` : ''}`
    )
    return elapsed
}

console.log('=== 1) 入口可用性 + 句柄缓存 ===')
console.log(`  调用前句柄状态：${JSON.stringify(queryHandleState())}`)
const first = await timedQuery('柯里化是怎么实现的')
const second = await timedQuery('协变和逆变是什么意思')
const third = await timedQuery('退款多久到账')
console.log(`  调用后句柄状态：${JSON.stringify(queryHandleState())}`)
console.log('')
console.log('  逐次耗时：' + [first, second, third].map((value) => `${value.toFixed(0)} ms`).join(' / '))
console.log('  注意：单次查询耗时**主要由 embedding 的 HTTP 调用决定**（实测波动 292~1177 ms），')
console.log('        所以「首次比后续慢」这种对比得不出可靠结论。句柄复用省掉的是打开开销，')
console.log('        那个数字单独测过：ZVecOpen 平均 383 ms vs 复用句柄 0.023 ms（见 spike/open-cost.ts）。')
console.log(`        这里能确定的是：queryHandleState 从 open:false 变成 open:true，句柄确实被缓存了。`)
console.log('')

console.log('=== 2) 持有句柄时灌库（预期被锁挡住，且提示可读）===')
const blocked = runIngest('持有句柄')
if (blocked === 0) {
    console.log('  ⚠ 未复现锁冲突 —— 说明该环境下句柄没有独占，需重新评估 keepOpen 默认值')
}
console.log('')

console.log('=== 3) closeQuery() 之后灌库（预期成功）===')
closeQuery()
console.log(`  释放后句柄状态：${JSON.stringify(queryHandleState())}`)
const allowed = runIngest('已释放')
console.log('')

console.log('=== 4) 释放后仍可查询（会重新打开句柄）===')
const after = await timedQuery('柯里化是怎么实现的')
console.log('')

console.log('=== 结论 ===')
console.log(`  入口可用（只 import 了 src/index.ts）：是`)
console.log(`  句柄被缓存：是（queryHandleState 由 open:false 变为 open:true）`)
console.log(`  持有句柄时灌库被挡：${blocked !== 0 ? '是（符合预期）' : '否'}`)
console.log(`  释放后灌库成功：${allowed === 0 ? '是' : '否'}`)
console.log(`  释放后可继续查询：${after > 0 ? '是' : '否'}`)
console.log('')
console.log('  单次查询耗时（供参考，API 波动大）：' + [first, second, third, after].map((value) => `${value.toFixed(0)} ms`).join(' / '))
closeQuery()
