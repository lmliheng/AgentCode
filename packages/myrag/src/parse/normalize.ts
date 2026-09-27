/**
 * 文本归一化：把 CJK 兼容字符还原成标准汉字。
 *
 * **为什么不能整体用 `String.prototype.normalize('NFKC')`** —— 实测它会把中文全角标点也改成
 * ASCII：`，`→`,`、`：`→`:`、`；`→`;`、`（`→`(`、`！`→`!`、全角空格→空格。
 * 对中文正文这是破坏性的（改动内容、影响展示与引用），所以这里
 * **只对兼容字符所在的码位区间逐字符做 NFKC**，其余字符原样保留。
 *
 * 覆盖区间：
 *   U+2E80–U+2FDF  CJK 部首补充 + Kangxi 部首（PDF/docx 抽取文本里大量出现：⽬ ⾦ ⼯ ⽂）
 *   U+F900–U+FAFF  CJK 兼容表意字
 *
 * 存在的原因：PDF 抽取出来的文本会用部首形式的字符，导致关键词检索失配 ——
 * 查「项目经历」对不上正文里的「项⽬经历」。实测影响面见 spike/compat-scan.ts
 * （86 文件 / 406 chunk 中只有 resume.pdf 的 1 个 chunk 受影响，98 个字符）。
 */
import type { Section } from '../types.js'

/**
 * NFKC 无法分解、必须显式映射的 CJK 部首补充字符（U+2E80–U+2EFF）。
 *
 * 每一项都是实测确认过的，**不猜**：猜错会静默篡改正文，比不修更糟。
 * 未列入的残留字符不会被强行转换，而是由 findResidualCompat 报告出来。
 */
const RADICAL_FIXES = new Map<string, string>([
    ['\u2ED3', '长'], // ⻓ CJK RADICAL C-SIMPLIFIED LONG
    ['\u2ED4', '门'], // ⻔ CJK RADICAL C-SIMPLIFIED GATE
])

/** 需要关注的兼容字符区间。用非全局正则，避免 lastIndex 副作用 */
const HINT = /[\u2E80-\u2FDF\uF900-\uFAFF]/

export function normalizeText(input: string): string {
    if (!HINT.test(input)) {
        return input
    }

    let output = ''
    // 用 for...of 迭代码位而不是下标，避免把代理对切成两半
    for (const character of input) {
        if (!HINT.test(character)) {
            output += character
            continue
        }
        const fixed = RADICAL_FIXES.get(character)
        output += fixed ?? character.normalize('NFKC')
    }
    return output
}

export interface CompatResidual {
    character: string
    code: string
    count: number
}

/**
 * 找出归一化之后**仍然残留**的兼容字符（NFKC 修不了、且不在显式映射表里）。
 *
 * 用途是报警而不是修：遇到没见过的部首字符时，宁可让解析警告里出现一行提示，
 * 也不要靠猜把它换成某个汉字。
 */
export function findResidualCompat(text: string): CompatResidual[] {
    const counts = new Map<string, number>()

    for (const character of text) {
        if (!HINT.test(character)) {
            continue
        }
        counts.set(character, (counts.get(character) ?? 0) + 1)
    }

    return [...counts.entries()]
        .map(([character, count]) => ({
            character,
            code: `U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`,
            count,
        }))
        .sort((first, second) => second.count - first.count)
}

/** 把残留字符渲染成一行解析警告 */
export function describeResidual(residuals: CompatResidual[]): string {
    const detail = residuals
        .slice(0, 6)
        .map((item) => `${item.character}(${item.code})×${item.count}`)
        .join('　')
    const more = residuals.length > 6 ? `　等 ${residuals.length} 种` : ''
    return `存在无法归一化的 CJK 兼容字符（会影响关键词检索）：${detail}${more}`
}

/**
 * 收集 section 里会进入 chunk 的全部文本，用于扫描残留兼容字符。
 *
 * 只看最终会入库的文本，而不是整个原始文件 —— 原始文件里可能有注释放着不管也没关系。
 */
export function collectSectionText(sections: Section[]): string {
    const parts: string[] = []

    for (const section of sections) {
        if (section.heading) {
            parts.push(section.heading)
        }
        for (const run of section.runs) {
            if (run.kind === 'text') {
                for (const unit of run.units) {
                    parts.push(unit.text)
                }
                continue
            }
            parts.push(run.table.header.join(' '))
            for (const row of run.table.rows) {
                parts.push(row.join(' '))
            }
        }
    }

    return parts.join('\n')
}
