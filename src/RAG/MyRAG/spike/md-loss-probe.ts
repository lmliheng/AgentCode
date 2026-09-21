/**
 * 量化 officeparser 解析 markdown 的有损程度。
 *
 * 已知问题：缩进在列表内的 fenced code block 会被解析成 paragraph，
 * 换行被压成空格，``` 标记泄漏进正文。
 *
 * 这里统计全语料的影响面，判断是否必须改用自己的 markdown 解析。
 *
 * 运行：tsx spike/md-loss-probe.ts
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseDocument } from '../src/parse/ast.js'

const DATA_DIR = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/Milvus/data'

function walk(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) out.push(...walk(path))
        else if (/\.md$/i.test(entry.name)) out.push(path)
    }
    return out
}

/** 数原文里有多少个 fenced code block（以 ``` 开头的行，成对计数） */
function countSourceFences(md: string): number {
    let open = false
    let count = 0
    for (const line of md.split('\n')) {
        if (line.trimStart().startsWith('```')) {
            if (!open) count++
            open = !open
        }
    }
    return count
}

const files = walk(DATA_DIR).filter((f) => !/[\\/]jsx[\\/]/.test(f))

let affectedFiles = 0
let leakedUnits = 0
let flattenedUnits = 0
let totalUnits = 0
let sourceBlocks = 0
let parsedCodeUnits = 0
const worst: Array<{ file: string; leaked: number; sourceBlocks: number }> = []

for (const path of files) {
    const fileName = path.split(/[\\/]/).pop()!
    const md = readFileSync(path, 'utf8')
    const blocks = countSourceFences(md)
    sourceBlocks += blocks

    const doc = await parseDocument(path, { fileType: 'md' })
    let leaked = 0

    for (const section of doc.sections) {
        for (const run of section.runs) {
            if (run.kind !== 'text') continue
            for (const unit of run.units) {
                totalUnits++
                if (unit.kind === 'code') {
                    parsedCodeUnits++
                    continue
                }
                if (unit.text.includes('```')) {
                    leaked++
                    totalUnits-- // 这是被错解析的单元，不重复计入
                }
                if (unit.text.length > 0 && (unit.text.match(/\n/g) ?? []).length === 0 && unit.text.length > 60) {
                    flattenedUnits++
                }
            }
        }
    }

    leakedUnits += leaked
    if (leaked > 0) {
        affectedFiles++
        worst.push({ file: fileName, leaked, sourceBlocks: blocks })
    }
}

worst.sort((a, b) => b.leaked - a.leaked)

console.log(`语料：${files.length} 篇 md`)
console.log('')
console.log(`原文 fenced code block 总数：${sourceBlocks}`)
console.log(`officeparser 正确解析为 code 节点的单元：${parsedCodeUnits}`)
console.log(`泄漏了 \`\`\` 标记的 paragraph 单元：${leakedUnits}`)
console.log('')
console.log(`受影响文件：${affectedFiles} / ${files.length} (${((affectedFiles / files.length) * 100).toFixed(1)}%)`)
console.log('')
console.log('受影响最严重的文件：')
for (const item of worst.slice(0, 12)) {
    console.log(`    ${item.file.padEnd(38)} 泄漏 ${String(item.leaked).padStart(3)} 个单元 / 原文 ${item.sourceBlocks} 个代码块`)
}
