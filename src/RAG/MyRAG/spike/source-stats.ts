/**
 * 按 source 统计已入库的 chunk 分布，用于校验灌库完整性。
 *
 * 主要用途：确认「同名文件」没有互相覆盖 —— 语料里存在
 * compiler/overview.md 与 typings/overview.md 这类同 basename 的文件，
 * 如果 source 用了 basename，后灌的会把先灌的删掉。
 *
 * 运行：tsx spike/source-stats.ts <collection 目录>
 */
import { resolve } from 'node:path'
import { ZVecOpen } from '@zvec/zvec'

const [dbPath] = process.argv.slice(2)
if (!dbPath) {
    console.error('用法：tsx spike/source-stats.ts <collection 目录>')
    process.exit(1)
}

const collection = ZVecOpen(resolve(dbPath))

const counts = new Map<string, number>()
let total = 0

for (const doc of collection.iterDocsSync()) {
    const source = String(doc.fields?.source ?? '(缺失)')
    counts.set(source, (counts.get(source) ?? 0) + 1)
    total++
}

console.log(`collection：${resolve(dbPath)}`)
console.log(`stats.docCount = ${collection.stats.docCount}`)
console.log(`遍历到 ${total} 条　source 去重后 ${counts.size} 个`)
console.log('')

// 已知的同名文件组，逐组确认两边都在
const KNOWN_DUPLICATES: string[][] = [
    ['compiler/overview.md', 'typings/overview.md'],
    ['faqs/enums.md', 'typings/enums.md'],
    ['faqs/modules.md', 'project/modules.md'],
]

console.log('=== 同名文件组（两边都应在库）===')
let missing = 0
for (const group of KNOWN_DUPLICATES) {
    const detail = group.map((source) => `${source}=${counts.get(source) ?? 0}`).join('　')
    const allPresent = group.every((source) => (counts.get(source) ?? 0) > 0)
    if (!allPresent) {
        missing++
    }
    console.log(`  ${allPresent ? '✓' : '✗'} ${detail}`)
}
console.log('')

// 仍然只用 basename 的 source（说明修复没生效）
const baseNameOnly = [...counts.keys()].filter((source) => !source.includes('/'))
console.log(`不含路径分隔符的 source：${baseNameOnly.length} 个`)
if (baseNameOnly.length > 0) {
    console.log(`  ${baseNameOnly.slice(0, 10).join('  ')}`)
}
console.log('')

console.log('chunk 数最多的 5 个 source：')
for (const [source, count] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    console.log(`  ${String(count).padStart(4)}  ${source}`)
}

collection.closeSync()
process.exit(missing > 0 ? 1 : 0)
