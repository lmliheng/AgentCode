/**
 * 定位「代码块 fence 不配对」的具体成因。
 *
 * 运行：tsx spike/fence-diagnose.ts
 */
import { parseDocument } from '../src/parse/ast.js'
import { DEFAULT_CHUNK_OPTIONS, documentToChunks } from '../src/chunk/index.js'

const FILE = 'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/Milvus/data/tips/infer.md'

const doc = await parseDocument(FILE, { fileType: 'md' })
const chunks = documentToChunks(doc, { category: 'x', owner: 'y', sourceVersion: 'v1' })

for (const chunk of chunks) {
    const lines = chunk.content.split('\n')
    const fenceLines = lines
        .map((line, index) => ({ line, index }))
        .filter((item) => item.line.trimStart().startsWith('```'))

    if (fenceLines.length % 2 === 0) continue

    console.log(`chunk ${chunk.id}  长度=${chunk.content.length}  fence 数=${fenceLines.length}（奇数）`)
    console.log('')
    console.log('所有 fence 行（行号 / 内容 / 紧邻的上一行）:')
    for (const { line, index } of fenceLines) {
        console.log(`  行${String(index).padStart(4)}  ${JSON.stringify(line)}`)
        console.log(`        上一行: ${JSON.stringify(lines[index - 1] ?? '')}`)
    }
    console.log('')
    console.log('该 chunk 的 kind / heading / group：', chunk.metadata.kind, chunk.metadata.heading, chunk.metadata.group)
    console.log('')

    // 看原始 AST 里这个文件的 code 节点长什么样
    const codeUnits = doc.sections
        .flatMap((s) => s.runs)
        .filter((r) => r.kind === 'text')
        .flatMap((r: any) => r.units)
        .filter((u: any) => u.kind === 'code')
    console.log(`原文 code 单元共 ${codeUnits.length} 个，逐个检查内部是否含 \`\`\`：`)
    codeUnits.forEach((unit: any, index: number) => {
        const inner = unit.text.split('\n').filter((l: string) => l.trimStart().startsWith('```'))
        if (inner.length > 0) {
            console.log(`  code[${index}] language=${unit.language} 内部含 ${inner.length} 行 \`\`\`：`)
            for (const line of inner.slice(0, 5)) console.log(`      ${JSON.stringify(line)}`)
        }
    })
    console.log(`  含 fence 的 code 单元检查完毕`)
}
