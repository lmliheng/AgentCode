// spike/paths.ts
//
// 探针脚本的数据根目录。
//
// 这一批 spike 写在仓库拆分之前，路径全是作者当年的绝对路径
// （C:/Users/Lenovo/Desktop/project/AgentCode/src/RAG/...），换台机器就一条都跑不了，
// 而报错是 ENOENT 指向一个不存在的 Windows 盘符 —— 排查半天才发现是路径问题。
//
// 现在统一从这里取。默认值按**当前仓库布局**推出来；语料那批（旧 Milvus/data）
// 随拆分留在了原仓库、没有迁过来，于是它额外在缺失时告警一句该设哪个变量。
// 其余几项在仓库里躺着，没用到它们的探针不必被别人的缺失刷屏。
//
// 可用的环境变量：
//   ACODE_MYRAG_ROOT  拆分前 src/RAG 那一层（其下有 Milvus/、MyRAG/）
//   ACODE_MYRAG_DATA  语料目录，默认 <ROOT>/Milvus/data
//   ACODE_MYRAG_DOCS  文档目录，默认 packages/rag-chunk/documents
//   ACODE_MYRAG_SEED  种子问题集，默认 packages/myrag/eval/queries.json
//   ACODE_MYRAG_ZVEC  zvec 库目录，默认 <ROOT>/MyRAG/zvec-data/myrag

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** 本文件所在目录（spike/） */
const SPIKE_DIR = import.meta.dirname

/** 仓库根：spike/ -> myrag/ -> packages/ -> 仓库根 */
export const REPO_ROOT = resolve(SPIKE_DIR, '../../..')

/** 拆分前 src/RAG 那一层的等价物，未设置时按仓库根兜底 */
export const RAG_ROOT = process.env.ACODE_MYRAG_ROOT ?? REPO_ROOT

/**
 * 取一个路径：环境变量优先，否则用按仓库布局推导的默认值。
 *
 * `warnOnMissing` 只给「仓库里确实没有」的那一项打开：缺失时把「该设哪个变量」
 * 直接说出来，而不是等调用方在 ENOENT 上猜。
 */
function pick(
  envValue: string | undefined,
  fallback: string,
  what: string,
  warnOnMissing: boolean,
): string {
  if (envValue !== undefined && envValue !== '') return envValue

  if (warnOnMissing && !existsSync(fallback)) {
    console.warn(
      `[spike] ${what} 默认路径不存在：${fallback}\n` +
      '        这些探针写在仓库拆分之前，数据可能没跟着过来；' +
      '用 ACODE_MYRAG_ROOT / ACODE_MYRAG_DATA 之类的环境变量指到实际位置。',
    )
  }
  return fallback
}

/** 语料根（当年是 src/RAG/Milvus/data） */
export const DATA_DIR = pick(
  process.env.ACODE_MYRAG_DATA,
  join(RAG_ROOT, 'Milvus', 'data'),
  '语料目录',
  true,
)

/** 文档目录（当年是 src/RAG/rag-chunk/documents，现在就在本仓库里） */
export const DOC_DIR = pick(
  process.env.ACODE_MYRAG_DOCS,
  join(REPO_ROOT, 'packages', 'rag-chunk', 'documents'),
  '文档目录',
  false,
)

/** 评测种子问题集 */
export const SEED_SET = pick(
  process.env.ACODE_MYRAG_SEED,
  join(SPIKE_DIR, '..', 'eval', 'queries.json'),
  '种子集',
  false,
)

/** zvec 库目录（探针自己会创建，缺了不算问题） */
export const ZVEC_DB = pick(
  process.env.ACODE_MYRAG_ZVEC,
  join(RAG_ROOT, 'MyRAG', 'zvec-data', 'myrag'),
  'zvec 目录',
  false,
)

/** 本目录下的产物路径（早先也是写死的绝对路径） */
export function spikeOutput(name: string): string {
  return join(SPIKE_DIR, name)
}
