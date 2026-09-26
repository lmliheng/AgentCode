// src/tools/fs-guard.ts

import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * 工作区路径守卫。
 *
 * 背景（见 run_test/PRD.md 第 4 节）：8 个文件工具各自手写了一遍
 * `path.startsWith(resolve(workspaceRoot))` 的字符串前缀比较，带来三类缺陷：
 *
 *   1. `search_code` 漏了 `resolve(p)`，`allowedPaths` 为相对路径（默认 `'.'`）时
 *      任何带 `path` 的搜索都会被误判为越权；
 *   2. `read_file` 完全没有边界检查，`../../package.json` 能直接读回；
 *   3. `startsWith` 是纯字符串比较：工作区为 `C:\ws` 时 `C:\ws-evil\x` 会被放行，
 *      `..` 与符号链接也能绕过。
 *
 * 本模块是唯一的判定入口：先 `resolve` 成绝对路径，再 `realpath` 解析符号链接
 * （目标不存在时退回其父目录的 realpath），最后用 `path.relative` 判断是否落在
 * 允许的根之内 —— 而不是比较字符串前缀。
 */

/** 判定结果：allowed 为 false 时 reason 是给人/模型看的原因 */
export interface GuardResult {
    allowed: boolean;
    /** 解析后的绝对路径（allowed 为 false 时是尽力解析的结果） */
    resolved: string;
    reason?: string;
}

/**
 * 把路径解析成绝对路径，并尽量解析符号链接。
 *
 * 目标不存在时（例如 `create_file` 要新建的文件）逐级向上找到第一个存在的祖先，
 * 解析它之后再拼回剩余部分 —— 否则「新建文件」会因为 realpath 失败而无法校验。
 */
function resolveRealPath(target: string): string {
    const absolute = resolve(target);
    let current = absolute;
    const tail: string[] = [];

    // 逐级向上，直到找到一个存在的路径（或到达根）
    for (;;) {
        try {
            const real = realpathSync(current);
            return tail.length > 0 ? resolve(real, ...tail.reverse()) : real;
        } catch {
            const parent = resolve(current, '..');
            if (parent === current) {
                // 已经到根仍不存在，退回纯字符串解析的结果
                return absolute;
            }
            tail.push(current.slice(parent.length).replace(/^[\\/]+/, ''));
            current = parent;
        }
    }
}

/**
 * 判断 target 是否落在 roots 中的某一个之内。
 *
 * @param target 待判定的路径（可为相对路径，相对 cwd 解析）
 * @param roots  允许的根目录列表（可为相对路径）
 */
export function isPathAllowed(target: string, roots: string[]): GuardResult {
    const resolved = resolveRealPath(target);

    if (roots.length === 0) {
        return { allowed: false, resolved, reason: '没有配置任何允许的工作区路径' };
    }

    for (const root of roots) {
        const realRoot = resolveRealPath(root);
        const rel = relative(realRoot, resolved);
        // rel === '' 表示就是根本身；不以 '..' 开头且不是绝对路径表示在根之内。
        // 用 relative 而不是 startsWith，天然避开 `C:\ws` 与 `C:\ws-evil` 的前缀碰撞。
        if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
            return { allowed: true, resolved };
        }
    }

    return {
        allowed: false,
        resolved,
        reason: `路径不在允许的工作区内（允许的根：${roots.join(', ')}）`,
    };
}

/**
 * 把用户传入的相对路径拼到工作区根上，并做边界校验。
 *
 * 这是文件工具的统一入口：`join(workspaceRoot, p)` + 边界检查一次完成，
 * 避免各工具再各写一遍（并再次写错）。
 */
export function resolveInWorkspace(
    workspaceRoot: string,
    target: string,
    allowedPaths: string[],
): GuardResult {
    const joined = resolve(workspaceRoot, target);
    // 允许的根以 allowedPaths 为准；未声明时退回工作区根本身
    const roots = allowedPaths.length > 0 ? allowedPaths : [workspaceRoot];
    return isPathAllowed(joined, roots);
}

/** 目录遍历时默认跳过的条目名（与 search_code 的默认 exclude 保持一致） */
export const DEFAULT_IGNORED_DIRS = ['node_modules', '.git', 'dist'] as const;

/** 判断某个条目名是否属于默认忽略集合 */
export function isIgnoredEntry(name: string, ignored: readonly string[] = DEFAULT_IGNORED_DIRS): boolean {
    return ignored.includes(name);
}

/** 供错误信息使用的路径展示：统一成正斜杠，避免 Windows 反斜杠在 JSON 里被转义 */
export function displayPath(p: string): string {
    return p.split(sep).join('/');
}
