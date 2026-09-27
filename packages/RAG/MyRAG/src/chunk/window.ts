import type { ChunkOptions, TextUnit } from '../types.js'

/**
 * 把内容重建为「markdown 风格的行流」，然后跑与 zg 相同的滑窗算法。
 *
 * 这样做的理由：AST 已经把标题层级、代码块边界、列表结构标好了，重建回行流之后
 * 就能原封不动地套用 zg 经过生产验证的切点打分逻辑，不需要为 AST 另写一套。
 */

export type LineKind =
    | 'blank' // 空行
    | 'plain' // 普通正文行
    | 'list' // 列表项
    | 'quote' // 引用
    | 'code' // 代码块内部，禁止在这些行上开新窗口
    | 'codeOpen' // 代码块起始 fence（允许在它之前断行）
    | 'codeClose' // 代码块结束 fence（禁止从这里开新窗口，否则会出现孤立的 ```）

export interface LineStream {
    lines: string[]
    kinds: LineKind[]
    /** 代码块内部行对应的开 fence 文本（含语言标记）；非内部行为 null */
    openers: Array<string | null>
}

export function buildLineStream(
    heading: string | null,
    level: number | null,
    units: TextUnit[]
): LineStream {
    const lines: string[] = []
    const kinds: LineKind[] = []
    const openers: Array<string | null> = []

    const push = (text: string, kind: LineKind, opener: string | null = null) => {
        lines.push(text)
        kinds.push(kind)
        openers.push(opener)
    }

    // 标题行本身是 section 内容的一部分（zg 的 section 也是从标题行开始的）
    if (heading) {
        push(`${'#'.repeat(level ?? 1)} ${heading}`, 'plain')
        push('', 'blank')
    }

    for (const unit of units) {
        const text = unit.text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim()
        if (!text) {
            continue
        }

        if (unit.kind === 'code') {
            const opener = '```' + (unit.language ?? '')
            push(opener, 'codeOpen')
            for (const line of text.split('\n')) {
                push(line, 'code', opener)
            }
            push('```', 'codeClose')
            push('', 'blank')
            continue
        }

        if (unit.kind === 'list' || unit.kind === 'definitionList') {
            for (const line of text.split('\n')) {
                push(line, 'list')
            }
            push('', 'blank')
            continue
        }

        for (const line of text.split('\n')) {
            push(line, 'plain')
        }
        push('', 'blank')
    }

    return { lines, kinds, openers }
}

/**
 * 切点打分。分值含义与 zg 的 markdownBreakScore 一致，
 * 但对 AST 才能提供的信息（代码块边界）做了更细的区分。
 */
function breakScore(lines: string[], kinds: LineKind[], index: number): number {
    if (index <= 0 || index >= lines.length) {
        return 0
    }

    // 代码块内部与结束 fence 上都不能开新窗口
    if (kinds[index] === 'code' || kinds[index] === 'codeClose') {
        return 0
    }
    // 代码块起始 fence 是很好的切点：切在代码块之前
    if (kinds[index] === 'codeOpen') {
        return 70
    }

    // 上面的边界检查保证了 index 与 index-1 都有效
    const current = (lines[index] ?? '').trim()
    const previous = (lines[index - 1] ?? '').trim()

    if (/^#{1,6}\s/.test(current)) {
        return 100
    }
    if (previous === '' && current === '') {
        return 70
    }
    if (previous === '') {
        return 60
    }
    if (/^([-*+]|\d+\.)\s/.test(current) || kinds[index] === 'list') {
        return 35
    }
    if (current.startsWith('>') || kinds[index] === 'quote') {
        return 25
    }
    return 10
}

/**
 * 在窗口后半段（≥70%）挑分数最高的切点。
 * 返回的 index 是「下一个窗口的第一行」，所以当前窗口是 [startIndex, index-1]。
 */
function chooseBreak(lines: string[], kinds: LineKind[], startIndex: number, endIndex: number): number {
    const minBreak = startIndex + Math.max(1, Math.floor((endIndex - startIndex) * 0.7))
    let bestBreak = endIndex
    let bestScore = breakScore(lines, kinds, endIndex)

    for (let index = minBreak; index <= endIndex; index++) {
        const score = breakScore(lines, kinds, index)
        if (score > bestScore) {
            bestBreak = index
            bestScore = score
        }
    }
    return bestBreak
}

/**
 * 从窗口末尾往前累计 overlapChars 个字符，换算成行数。
 * 上限是半个窗口，避免 overlap 吃掉整个窗口导致死循环。
 */
function computeOverlapLines(
    lines: string[],
    startIndex: number,
    endIndex: number,
    overlapChars: number
): number {
    if (overlapChars <= 0) {
        return 0
    }
    let chars = 0
    let count = 0
    for (let index = endIndex - 1; index > startIndex; index--) {
        chars += (lines[index] ?? '').length + 1
        if (chars > overlapChars) {
            break
        }
        count++
    }
    return Math.min(count, Math.floor((endIndex - startIndex) / 2))
}

/** 单行超长时的切点：优先句末标点，其次逗号类，再次空格 */
function findLineCut(line: string, maxChars: number): number {
    const minPosition = Math.floor(maxChars * 0.7)
    let bestPosition = -1
    let bestScore = 0

    for (let index = minPosition; index < maxChars; index++) {
        const character = line[index]
        // line 可能短于 maxChars，越界下标取不到字符：原来这些位置也评不出分，直接跳过
        if (character === undefined) {
            continue
        }
        let score = 0

        // 相比 zg 增加了中文标点：中文句子以 。！？ 结尾、以 ，；：、 分隔，
        // 原版只认 ASCII 标点，中文长段落会被硬切断。
        if ('.!?。！？'.includes(character)) {
            score = 4
        } else if (',;:，；：、'.includes(character)) {
            score = 3
        } else if (character === ' ' || character === '\t') {
            score = 2
        } else if (character === '-' || character === '/' || character === '\\') {
            score = 1
        }

        if (score >= bestScore && score > 0) {
            bestScore = score
            bestPosition = index + 1
        }
    }

    return bestPosition > 0 ? bestPosition : maxChars
}

export function splitLongLine(line: string, maxChars: number): string[] {
    const pieces: string[] = []
    let offset = 0

    while (offset < line.length) {
        const remaining = line.length - offset
        const take = remaining <= maxChars ? remaining : findLineCut(line.slice(offset), maxChars)
        pieces.push(line.slice(offset, offset + take))
        offset += take
    }
    return pieces
}

/**
 * 把行流按 maxChunkChars 切成若干窗口，返回每个窗口的文本。
 *
 * 当一个窗口必须切在代码块内部时（代码块本身超过 maxChunkChars，无法避免），
 * 会给当前窗口补上结束 fence、给下一个窗口补上开 fence，
 * 否则两边都留下不配对的 ``` ，读起来像代码块未闭合。
 */
export function windowize(stream: LineStream, options: ChunkOptions): string[] {
    const { lines, kinds, openers } = stream
    if (lines.length === 0) {
        return []
    }

    const maxChars = options.maxChunkChars
    const end = lines.length - 1
    const windows: string[] = []
    let start = 0

    const emit = (from: number, to: number, preOpener: string | null) => {
        const body = lines.slice(from, to).join('\n')
        const parts: string[] = []
        if (preOpener) {
            parts.push(preOpener)
        }
        parts.push(body)
        // 窗口最后一行是代码块内部 ⇒ 代码块延续到下一个窗口，这里补结束 fence
        if (kinds[to - 1] === 'code') {
            parts.push('```')
        }
        windows.push(parts.join('\n'))
    }

    while (start <= end) {
        // 续窗时如果起点落在代码块内部，需要补上开 fence
        const preOpener = kinds[start] === 'code' ? openers[start] ?? null : null
        const startLine = lines[start] ?? ''

        // 单行本身超过上限：只能按句末标点切开
        if (startLine.length + 1 > maxChars) {
            const pieces = splitLongLine(startLine, maxChars)
            for (let i = 0; i < pieces.length; i++) {
                const parts: string[] = []
                if (preOpener) parts.push(preOpener)
                parts.push(pieces[i] ?? '')
                if (kinds[start] === 'code' && i < pieces.length - 1) parts.push('```')
                windows.push(parts.join('\n'))
            }
            start++
            continue
        }

        let cursor = start
        let usedChars = 0
        while (cursor <= end) {
            const lineLength = (lines[cursor] ?? '').length + 1
            if (usedChars + lineLength > maxChars && cursor > start) {
                break
            }
            usedChars += lineLength
            cursor++
        }

        if (cursor <= end && cursor - start > 1) {
            cursor = chooseBreak(lines, kinds, start, cursor)
        }

        // 窗口不能以「代码块起始 fence」结尾：那样这个窗口只有开 fence 没有内容与闭 fence。
        // 把切点往前挪一行，让开 fence 归属下一个窗口。
        if (cursor > start + 1 && kinds[cursor - 1] === 'codeOpen') {
            cursor -= 1
        }

        emit(start, cursor, preOpener)

        if (cursor > end) {
            break
        }
        const overlapLines = computeOverlapLines(lines, start, cursor, options.chunkOverlapChars)
        const nextStart = cursor - overlapLines
        start = nextStart > start ? nextStart : cursor
    }

    return windows.filter((window) => window.trim().length > 0)
}
