import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { WxCloudResult } from '../types.js'

// ---------------------------------------------------------------------------
// wxcloud CLI 路径
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @wxcloud/cli 的 bin 入口 */
export const WXCLI_BIN = join(
  __dirname,
  '..',
  '..',
  'node_modules',
  '@wxcloud',
  'cli',
  'bin',
  'run'
)

// ---------------------------------------------------------------------------
// 执行 wxcloud 命令
// ---------------------------------------------------------------------------

export function runWxCloud(
  args: string[],
  timeoutMs = 120_000
): Promise<WxCloudResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'node',
      [WXCLI_BIN, ...args],
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && error.killed === true) {
          reject(new Error(`命令执行超时（${timeoutMs / 1000}s）`))
          return
        }
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? (error ? error.message : ''),
        })
      }
    )
  })
}

export async function runWxCloudJson(args: string[], timeoutMs?: number) {
  const { stdout, stderr } = await runWxCloud(args, timeoutMs)
  const trimmed = stdout.trim()
  try {
    return { data: JSON.parse(trimmed) as unknown, stderr }
  } catch {
    return { data: trimmed, stderr }
  }
}

// ---------------------------------------------------------------------------
// 响应构造
// ---------------------------------------------------------------------------

export interface ToolContent {
  type: 'text'
  text: string
}

export interface ToolResult {
  content: ToolContent[]
  isError?: boolean
  structuredContent?: unknown
  [key: string]: unknown
}

export function okResult(text: string, structured?: unknown): ToolResult {
  const result: ToolResult = {
    content: [{ type: 'text', text }],
  }
  if (structured !== undefined) {
    result.structuredContent = structured
  }
  return result
}

export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  }
}

/** 尽量返回 JSON；解析失败回退为原始文本 */
export async function jsonOrRaw(args: string[], timeoutMs?: number) {
  const { data } = await runWxCloudJson(args, timeoutMs)
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  return okResult(text, typeof data !== 'string' ? data : undefined)
}