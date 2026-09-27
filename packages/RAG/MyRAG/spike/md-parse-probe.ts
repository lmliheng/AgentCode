/**
 * 验证主力语料（md）走 officeparser 的效果。
 *
 * 这是 MyRAG 当前 100% 的语料形态，所以这个结果直接决定 M3 用谁的方案：
 *   A. officeparser 的 AST + 它自带的 chunks
 *   B. 移植 zg 的 MarkdownExtractor（吃原始 markdown 文本）
 *
 * 关注点：
 *   1. md 走 officeparser 能否拿到 heading 节点和层级
 *   2. splitBy: 'heading' + maxChunkSize 产出的 chunk 大小分布
 *   3. 对比沿用 zg 的 3600/540 会得到什么
 *
 * 运行：tsx spike/md-parse-probe.ts
 */
import { OfficeParser } from 'officeparser'

const SAMPLES = [
  'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/Milvus/data/compiler/ast.md',
  'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/Milvus/data/tips/curry.md',
  'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/Milvus/data/tips/covarianceAndContravariance.md',
]

function walk(nodes: any[], fn: (n: any, depth: number) => void, depth = 0) {
  for (const n of nodes ?? []) {
    fn(n, depth)
    if (n?.children) walk(n.children, fn, depth + 1)
  }
}

function sizeStats(sizes: number[]) {
  const s = [...sizes].sort((a, b) => a - b)
  const sum = s.reduce((a, b) => a + b, 0)
  return {
    数量: s.length,
    最小: s[0] ?? 0,
    中位: s[Math.floor(s.length / 2)] ?? 0,
    最大: s[s.length - 1] ?? 0,
    平均: s.length ? Math.round(sum / s.length) : 0,
    总计: sum,
  }
}

for (const path of SAMPLES) {
  const name = path.split('/').pop()!
  console.log('='.repeat(78))
  console.log(`样本：${name}`)
  console.log('='.repeat(78))

  const ast: any = await OfficeParser.parseOffice(path, { fileType: 'md' })

  // ---- 节点类型
  const counts = new Map<string, number>()
  const headings: Array<{ level?: number; text: string }> = []
  walk(ast.content ?? [], (n) => {
    counts.set(n?.type ?? 'unknown', (counts.get(n?.type ?? 'unknown') ?? 0) + 1)
    if (n?.type === 'heading') headings.push({ level: n.level ?? n.metadata?.level, text: n.text ?? '' })
  })
  console.log(`节点类型：${[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}×${c}`).join('  ')}`)
  console.log(`heading 节点：${headings.length} 个`)
  for (const h of headings.slice(0, 6)) {
    console.log(`    level=${h.level ?? '?'}  ${h.text.replace(/\s+/g, ' ').slice(0, 64)}`)
  }
  console.log('')

  // ---- 默认 chunks
  const def = await ast.to('chunks')
  const defChunks: any[] = Array.isArray(def.value) ? def.value : []
  console.log(`默认 chunks：${JSON.stringify(sizeStats(defChunks.map((c) => c.text.length)))}`)
  console.log(`  前 3 个：${defChunks.slice(0, 3).map((c) => `[${c.text.length}]"${c.text.replace(/\s+/g, ' ').slice(0, 30)}"`).join('  ')}`)
  console.log('')

  // ---- splitBy: heading + maxChunkSize 3600（对齐 zg 的参数）
  const byHeading = await ast.to('chunks', {
    chunksConfig: { strategy: 'document-structure', splitBy: 'heading', maxChunkSize: 3600 },
  })
  const hChunks: any[] = Array.isArray(byHeading.value) ? byHeading.value : []
  console.log(`splitBy='heading' + maxChunkSize=3600：${JSON.stringify(sizeStats(hChunks.map((c) => c.text.length)))}`)
  for (const c of hChunks.slice(0, 4)) {
    console.log(`    [${c.text.length}] heading=${JSON.stringify(c.metadata?.closestHeading ?? null)}`)
    console.log(`        ${c.text.replace(/\s+/g, ' ').slice(0, 90)}`)
  }
  console.log('')

  // ---- pdf 风格：paragraph + 大 maxChunkSize
  const byPara = await ast.to('chunks', {
    chunksConfig: { strategy: 'document-structure', splitBy: 'paragraph', maxChunkSize: 3600 },
  })
  const pChunks: any[] = Array.isArray(byPara.value) ? byPara.value : []
  console.log(`splitBy='paragraph' + maxChunkSize=3600：${JSON.stringify(sizeStats(pChunks.map((c) => c.text.length)))}`)
  console.log('')

  // ---- fixed-size 3600/540（对齐 zg 的参数）
  const fixed = await ast.to('chunks', {
    chunksConfig: { strategy: 'fixed-size', chunkSize: 3600, chunkOverlap: 540 },
  })
  const fChunks: any[] = Array.isArray(fixed.value) ? fixed.value : []
  console.log(`fixed-size 3600/540：${JSON.stringify(sizeStats(fChunks.map((c) => c.text.length)))}`)
  console.log('')
}
