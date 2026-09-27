/**
 * 用真实样本验证 officeparser 的解析质量与分块能力。
 *
 * 样本（项目里已存在的真实文件，不是我造的）：
 *   ../rag-chunk/documents/报告.docx
 *   ../rag-chunk/documents/resume.pdf
 *
 * 目的：
 *   1. docx / pdf 能否解析出结构（heading / table / list 节点）
 *   2. PDF 是否真的还原了版面（这个是关键卖点，必须验证）
 *   3. 它自带的 chunks 输出长什么样，和 zg 的 heading+breadcrumb 方案差多少
 *
 * 运行：tsx spike/parser-probe.ts
 */
import { readFileSync } from 'node:fs'
import { OfficeParser } from 'officeparser'

const SAMPLES = [
  'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/rag-chunk/documents/报告.docx',
  'C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/rag-chunk/documents/resume.pdf',
]

/** 递归统计 AST 里出现的节点类型 */
function nodeTypeCounts(content: any[], counts = new Map<string, number>()) {
  for (const node of content ?? []) {
    const t = node?.type ?? 'unknown'
    counts.set(t, (counts.get(t) ?? 0) + 1)
    if (node?.children) nodeTypeCounts(node.children, counts)
  }
  return counts
}

function preview(s: unknown, n = 110) {
  return String(s ?? '').replace(/\s+/g, ' ').slice(0, n)
}

for (const path of SAMPLES) {
  const name = path.split('/').pop()!
  console.log('='.repeat(78))
  console.log(`样本：${name}`)
  console.log('='.repeat(78))

  const buf = readFileSync(path)
  console.log(`文件大小：${(buf.length / 1024).toFixed(1)} KB`)

  let ast: any
  const t0 = Date.now()
  try {
    ast = await OfficeParser.parseOffice(path)
  } catch (e: any) {
    console.log(`解析失败：${e?.message ?? e}`)
    console.log('')
    continue
  }
  console.log(`解析耗时：${Date.now() - t0} ms`)
  console.log(`ast.type = ${ast.type}`)
  console.log(`metadata = ${JSON.stringify(ast.metadata ?? {}).slice(0, 200)}`)

  const counts = nodeTypeCounts(ast.content ?? [])
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  console.log(`节点类型统计：${sorted.map(([t, c]) => `${t}×${c}`).join('  ')}`)
  console.log(`warnings = ${(ast.warnings ?? []).length} 条`)
  for (const w of (ast.warnings ?? []).slice(0, 3)) {
    console.log(`    ⚠ ${preview(w?.message ?? w, 130)}`)
  }
  console.log('')

  // ---- heading 节点是否真的带层级
  const headings: Array<{ level?: number; text: string }> = []
  const walk = (nodes: any[]) => {
    for (const n of nodes ?? []) {
      if (n?.type === 'heading') headings.push({ level: n.level ?? n.metadata?.level, text: n.text ?? '' })
      if (n?.children) walk(n.children)
    }
  }
  walk(ast.content ?? [])
  console.log(`heading 节点：${headings.length} 个`)
  for (const h of headings.slice(0, 8)) {
    console.log(`    level=${h.level ?? '?'}  ${preview(h.text, 70)}`)
  }
  console.log('')

  // ---- table 节点
  let tables = 0
  const walkTables = (nodes: any[]) => {
    for (const n of nodes ?? []) {
      if (n?.type === 'table') tables++
      if (n?.children) walkTables(n.children)
    }
  }
  walkTables(ast.content ?? [])
  console.log(`table 节点：${tables} 个`)
  console.log('')

  // ---- text 输出
  try {
    const { value: text } = await ast.to('text', { textConfig: { preserveLayout: false } })
    console.log(`--- to('text') 扁平模式，共 ${String(text).length} 字符 ---`)
    console.log(preview(text, 400))
    console.log('')
  } catch (e: any) {
    console.log(`to('text') 失败：${e?.message ?? e}`)
  }

  // ---- md 输出
  try {
    const { value: md } = await ast.to('md')
    console.log(`--- to('md')，共 ${String(md).length} 字符 ---`)
    console.log(preview(md, 400))
    console.log('')
  } catch (e: any) {
    console.log(`to('md') 失败：${e?.message ?? e}`)
  }

  // ---- chunks 输出
  try {
    const { value: chunks } = await ast.to('chunks')
    const list = Array.isArray(chunks) ? chunks : []
    console.log(`--- to('chunks') 默认配置，共 ${list.length} 个 chunk ---`)
    for (const c of list.slice(0, 4)) {
      const content = (c as any)?.content ?? (c as any)?.text ?? ''
      console.log(`    [${(c as any)?.length ?? content.length} 字符] ${preview(content, 150)}`)
    }
    console.log(`    chunk 的字段：${JSON.stringify(Object.keys(list[0] ?? {}))}`)
    console.log(`    首个 chunk 完整结构：${JSON.stringify(list[0]).slice(0, 400)}`)
  } catch (e: any) {
    console.log(`to('chunks') 失败：${e?.message ?? e}`)
  }
  console.log('')
}
