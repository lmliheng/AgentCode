/**
 * 探测 officeparser AST 的真实节点形状。
 *
 * 写适配器之前必须先看清楚各类型节点的字段（尤其 list / code / table 的 children 结构），
 * 否则只能靠猜，适配器一定写错。
 *
 * 运行：tsx spike/ast-shape-probe.ts
 */
import { OfficeParser, type SupportedFileType } from 'officeparser'

const SAMPLES: Array<[string, SupportedFileType | undefined]> = [
  ['C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/Milvus/data/compiler/ast.md', 'md'],
  ['C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/Milvus/data/tips/curry.md', 'md'],
  ['C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/rag-chunk/documents/报告.docx', undefined],
  ['C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/rag-chunk/documents/resume.pdf', undefined],
]

/** 去掉冗长字段，只保留结构信息 */
function slim(node: any, depth = 0): any {
  if (depth > 3 || !node || typeof node !== 'object') return node
  const out: any = {}
  for (const [k, v] of Object.entries(node)) {
    if (k === 'children' || k === 'notes' || k === 'comments') {
      const arr = v as any[]
      if (!Array.isArray(arr) || arr.length === 0) continue
      out[`${k}[${arr.length}]`] = arr.slice(0, 2).map((c) => slim(c, depth + 1))
      continue
    }
    if (k === 'formatting' || k === 'metadata') {
      const o = v as Record<string, unknown>
      if (!o || typeof o !== 'object') continue
      const kept: Record<string, unknown> = {}
      for (const [kk, vv] of Object.entries(o)) {
        if (typeof vv === 'string' && vv.length > 40) kept[kk] = `${vv.slice(0, 40)}…`
        else kept[kk] = vv
      }
      if (Object.keys(kept).length > 0) out[k] = kept
      continue
    }
    if (k === 'rawContent' || k === 'raw' || k === 'attachments' || k === 'config') continue
    if (typeof v === 'string' && v.length > 90) out[k] = `${v.slice(0, 90)}…`
    else out[k] = v
  }
  return out
}

function collectByType(nodes: any[], byType: Map<string, any[]>, depth = 0) {
  for (const n of nodes ?? []) {
    const t = String(n?.type ?? 'unknown')
    if (!byType.has(t)) byType.set(t, [])
    const list = byType.get(t)!
    if (list.length < 2) list.push(n)
    if (n?.children) collectByType(n.children, byType, depth + 1)
    if (n?.notes) collectByType(n.notes, byType, depth + 1)
    if (n?.comments) collectByType(n.comments, byType, depth + 1)
  }
}

for (const [path, fileType] of SAMPLES) {
  const name = path.split('/').pop()!
  console.log('='.repeat(78))
  console.log(`样本：${name}`)
  console.log('='.repeat(78))

  const ast: any = await OfficeParser.parseOffice(path, fileType ? { fileType } : {})
  const byType = new Map<string, any[]>()
  collectByType(ast.content ?? [], byType)

  console.log(`顶层节点 type 分布：${[...byType.entries()].map(([t, a]) => `${t}×${a.length === 2 ? '2+' : a.length}`).join('  ')}`)
  console.log('')

  // 重点关注这几种：它们决定适配器怎么写
  for (const target of ['heading', 'paragraph', 'list', 'code', 'table', 'row', 'cell', 'text', 'page', 'sheet']) {
    const samples = byType.get(target)
    if (!samples) continue
    console.log(`--- ${target} 节点形状（最多 2 个）---`)
    console.log(JSON.stringify(slim(samples[0]), null, 2))
    if (samples[1]) console.log('  第 2 个：', JSON.stringify(slim(samples[1])).slice(0, 300))
    console.log('')
  }
}
