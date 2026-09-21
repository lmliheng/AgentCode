/**
 * 测量「打开 collection 句柄」的开销。
 *
 * 用途：决定 query() 对外 API 是否该缓存句柄。
 * 已知持有句柄会挡住其他进程的写入（见 2026-09-21 锁冲突实测），所以只有当打开开销
 * 明显偏大时，才值得用「缓存 + 显式释放」的复杂度去换。
 *
 * 运行：tsx spike/open-cost.ts [collection 目录]
 */
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { ZVecOpen } from '@zvec/zvec'

const DB = resolve(process.argv[2] ?? './zvec-data/myrag')
if (!existsSync(DB)) {
    console.error(`collection 不存在：${DB}`)
    process.exit(1)
}

console.log(`collection：${DB}`)
console.log('')

const ROUNDS = 5
const openDurations: number[] = []

for (let round = 1; round <= ROUNDS; round++) {
    const startedAt = performance.now()
    const collection = ZVecOpen(DB)
    const openedAt = performance.now()
    const count = collection.stats.docCount
    collection.closeSync()
    const closedAt = performance.now()

    const openMs = openedAt - startedAt
    const statsMs = closedAt - openedAt
    openDurations.push(openMs)
    console.log(`  第 ${round} 轮：ZVecOpen ${openMs.toFixed(1)} ms　stats ${statsMs.toFixed(1)} ms　文档数 ${count}`)
}

const mean = openDurations.reduce((sum, value) => sum + value, 0) / openDurations.length
console.log('')
console.log(`ZVecOpen 平均 ${mean.toFixed(1)} ms（最小 ${Math.min(...openDurations).toFixed(1)} / 最大 ${Math.max(...openDurations).toFixed(1)}）`)
console.log('')

// 对比：复用同一个句柄连续读取
const collection = ZVecOpen(DB)
const reuseStart = performance.now()
for (let index = 0; index < 5; index++) {
    void collection.stats.docCount
}
const reuseMs = performance.now() - reuseStart
collection.closeSync()
console.log(`复用句柄连续读 5 次 stats：合计 ${reuseMs.toFixed(2)} ms（每次 ${(reuseMs / 5).toFixed(3)} ms）`)
console.log('')
console.log(
  mean < 200
    ? '结论：打开开销不大，可以「每次查询打开再关闭」，无需缓存句柄。'
    : '结论：打开开销明显，常驻服务值得缓存句柄（但要接受它挡住其他进程的写入，并需要显式释放）。',
)
void rmSync
