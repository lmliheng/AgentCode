/**
 * 扫描语料里的「CJK 兼容/部首字符」，量化它对检索的影响面。
 *
 * 背景：PDF/docx 抽出的文本里会出现部首形式的假名汉字，例如
 *   ⽬ U+2F6C（Kangxi 部首）→ 目 U+76EE      NFKC 可以修
 *   ⻓ U+2ED3（部首补充）    → 长 U+957F      NFKC 修不了，需要显式映射
 * 这些字符会让关键词检索（FTS）与精确匹配失效：
 * 查询「项目经历」对不上正文里的「项⽬经历」。
 *
 * 运行：tsx spike/compat-scan.ts
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseFile } from '../src/parse/index.js'
import { documentToChunks } from '../src/chunk/index.js'

const DATA_DIR = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/Milvus/data'
const DOC_DIR = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/rag-chunk/documents'

/** CJK 部首补充（U+2E80–U+2EFF）与 Kangxi 部首（U+2F00–U+2FDF） */
const COMPAT = /[\u2e80-\u2fdf]/g

function walk(dir: string, extensions: RegExp): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'jsx') continue
        const path = join(dir, entry.name)
        if (entry.isDirectory()) out.push(...walk(path, extensions))
        else if (extensions.test(entry.name)) out.push(path)
    }
    return out
}

const files = [
    ...walk(DATA_DIR, /\.md$/i),
    ...walk(DOC_DIR, /\.(md|docx|pdf)$/i),
]

const perChar = new Map<string, { count: number; code: string; nfkcFixes: boolean }>()
const perFile: Array<{ file: string; hits: number }> = []
let affectedChunks = 0
let totalChunks = 0

for (const path of files) {
    const name = path.split(/[\\/]/).pop() ?? path
    let hits = 0

    try {
        const doc = await parseFile(path)
        const chunks = documentToChunks(doc, {
            category: 'scan',
            owner: 'scan',
            sourceVersion: 'v1',
        })

        for (const chunk of chunks) {
            totalChunks++
            const found = chunk.content.match(COMPAT)
            if (!found) continue
            affectedChunks++
            hits += found.length

            for (const character of found) {
                const existing = perChar.get(character)
                if (existing) {
                    existing.count++
                    continue
                }
                perChar.set(character, {
                    count: 1,
                    code: `U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`,
                    nfkcFixes: character.normalize('NFKC') !== character,
                })
            }
        }
    } catch (error) {
        console.log(`  （${name} 解析失败：${(error as Error).message.slice(0, 60)}）`)
        continue
    }

    if (hits > 0) {
        perFile.push({ file: name, hits })
    }
}

console.log(`扫描 ${files.length} 个文件　${totalChunks} 个 chunk`)
console.log(`受影响 chunk：${affectedChunks} / ${totalChunks}`)
console.log(`受影响文件：${perFile.length}`)
console.log('')

const sorted = [...perChar.entries()].sort((a, b) => b[1].count - a[1].count)
console.log(`出现的兼容字符共 ${sorted.length} 种（按出现次数排序）：`)
console.log('| 字符 | 码位 | NFKC 能修? | 次数 |')
console.log('|---|---|---|---|')
for (const [character, info] of sorted) {
    console.log(`| ${character} | ${info.code} | ${info.nfkcFixes ? '✅' : '❌ 需显式映射'} | ${info.count} |`)
}
console.log('')

const needsManual = sorted.filter(([, info]) => !info.nfkcFixes)
console.log(
    `NFKC 能修的：${sorted.length - needsManual.length} 种　` +
        `NFKC 修不了（需补映射表）：${needsManual.length} 种`
)
if (needsManual.length > 0) {
    console.log('')
    console.log('需要显式映射的字符：')
    for (const [character, info] of needsManual) {
        console.log(`  ${character} (${info.code}) → ?　出现 ${info.count} 次`)
    }
}
console.log('')
console.log('受影响文件：')
for (const item of perFile.sort((a, b) => b.hits - a.hits)) {
    console.log(`  ${String(item.hits).padStart(5)}  ${item.file}`)
}
