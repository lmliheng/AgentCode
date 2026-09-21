/**
 * 打印 infer.md 解析出的原始单元文本，确认 code / paragraph 的换行是否被保留。
 *
 * 运行：tsx spike/unit-dump.ts
 */
import { parseFile } from '../src/parse/index.js'

const FILE = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/Milvus/data/tips/infer.md'

const doc = await parseFile(FILE)

let index = 0
for (const section of doc.sections) {
    console.log(`### section: heading=${JSON.stringify(section.heading)} breadcrumb=${JSON.stringify(section.breadcrumb)}`)
    for (const run of section.runs) {
        if (run.kind === 'table') {
            console.log(`  [table] ${run.table.rows.length} 行`)
            continue
        }
        for (const unit of run.units) {
            index++
            const text = unit.text
            const newlineCount = (text.match(/\n/g) ?? []).length
            console.log(
                `  [${String(index).padStart(2)}] ${unit.kind.padEnd(10)} 长度=${String(text.length).padStart(5)} 换行=${newlineCount}` +
                    (unit.language ? ` lang=${unit.language}` : '')
            )
            console.log(`       ${JSON.stringify(text.slice(0, 160))}`)
        }
    }
}
