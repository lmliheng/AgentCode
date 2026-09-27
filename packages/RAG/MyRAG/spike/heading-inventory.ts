/**
 * 输出语料的话题地图：每个文件的 H1 与前几个 H2。
 *
 * 用途：扩充评测标注集时需要「哪些主题在哪个文件里」的准确信息，
 * 凭空编问句会得到错误的 expectSources，指标就没意义了。
 *
 * 运行：tsx spike/heading-inventory.ts
 */
import { readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parseFile } from '../src/parse/index.js'

const ROOT = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/Milvus/data'

function walk(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'jsx') continue
        const path = join(dir, entry.name)
        if (entry.isDirectory()) out.push(...walk(path))
        else if (/\.md$/i.test(entry.name)) out.push(path)
    }
    return out
}

for (const path of walk(ROOT).sort()) {
    const source = relative(resolve(ROOT), resolve(path)).split(/[\\/]/).join('/')
    const doc = await parseFile(path)

    const h1 = doc.sections.filter((section) => section.level === 1).map((section) => section.heading)
    const h2 = doc.sections.filter((section) => section.level === 2).map((section) => section.heading)

    const summary = [
        `${String(doc.sections.length).padStart(2)} sec`,
        `H1: ${h1.slice(0, 2).join(' / ') || '-'}`,
        `H2: ${h2.slice(0, 5).join(' / ') || '-'}${h2.length > 5 ? ` …(共${h2.length})` : ''}`,
    ].join('　')

    console.log(`${source.padEnd(36)} ${summary}`)
}
