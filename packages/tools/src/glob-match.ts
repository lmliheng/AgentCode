// src/glob-match.ts
//
// 极小的 glob 匹配器：只支持 `*`、`?`、`**` 与 `{a,b}`。
//
// 为什么自己写而不是引 minimatch：tools 包目前零依赖（只用 node 内建），而这套
// 语义只有几十行。引一个带依赖树的库进来，换来的是我们用不到的 extglob、posix
// 字符类、否定模式等等，而「模型照着描述写会不会踩空」这件事，靠的是把支持的
// 语义写进工具描述，不是靠库支持得多。不支持的写法在这里当作普通字符，
// 于是它只会「匹配不到」，不会「匹配错」。

import { sep } from 'node:path';

/** 花括号展开的上限：`{a,b}{c,d}...` 是指数级的，不能让一个模式把内存拉满 */
const MAX_BRACE_EXPANSIONS = 64;

/** 含这些字符就按通配符处理（否则按字面前缀，见 matchesNamePattern） */
const GLOB_METACHARACTERS = /[*?{]/;

/** 统一成 `/` 分隔、去掉开头的 `./`，使匹配不受调用方的写法影响 */
function normalize(target: string): string {
    return target.split(sep).join('/').split('\\').join('/').replace(/^\.\//, '');
}

export function hasWildcard(pattern: string): boolean {
    return GLOB_METACHARACTERS.test(pattern);
}

/**
 * 展开 `{a,b}`（可嵌套）。
 *
 * 没有花括号时返回原模式本身；括号不配对或只有一个选项时也按字面处理 ——
 * 「{a}」在 shell 里同样不展开，凭空猜一个意思比不匹配更难排查。
 */
export function expandBraces(pattern: string): string[] {
    const open = pattern.indexOf('{');
    if (open === -1) return [pattern];

    let depth = 0;
    let close = -1;
    for (let i = open; i < pattern.length; i += 1) {
        if (pattern[i] === '{') depth += 1;
        else if (pattern[i] === '}') {
            depth -= 1;
            if (depth === 0) {
                close = i;
                break;
            }
        }
    }
    if (close === -1) return [pattern];

    const prefix = pattern.slice(0, open);
    const body = pattern.slice(open + 1, close);
    const suffix = pattern.slice(close + 1);

    // 只按顶层逗号切分：嵌套括号里的逗号属于内层
    const options: string[] = [];
    let inner = 0;
    let current = '';
    for (const ch of body) {
        if (ch === '{') inner += 1;
        if (ch === '}') inner -= 1;
        if (ch === ',' && inner === 0) {
            options.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    options.push(current);

    if (options.length < 2) return [pattern];

    const expanded: string[] = [];
    for (const option of options) {
        for (const rest of expandBraces(prefix + option + suffix)) {
            expanded.push(rest);
            if (expanded.length >= MAX_BRACE_EXPANSIONS) return expanded;
        }
    }
    return expanded;
}

/** 单个（已展开的）模式编译成正则 */
function compileSingle(pattern: string): RegExp {
    let source = '';

    for (let i = 0; i < pattern.length; i += 1) {
        const ch = pattern[i]!;

        if (ch === '*') {
            if (pattern[i + 1] === '*') {
                if (pattern[i + 2] === '/') {
                    // `**/` 跨任意层目录，也可以一层都不跨（`**/a.ts` 要能匹配 `a.ts`）
                    source += '(?:.*/)?';
                    i += 2;
                } else {
                    source += '.*';
                    i += 1;
                }
            } else {
                source += '[^/]*';
            }
            continue;
        }

        if (ch === '?') {
            source += '[^/]';
            continue;
        }

        source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    return new RegExp(`^${source}$`);
}

/**
 * 把模式编译成判定函数。
 *
 * 编译一次、判定多次：一个 glob 会对着几百个路径反复问「匹配吗」，
 * 每个路径现编译一遍正则纯属浪费。
 */
export function compileGlob(pattern: string): (path: string) => boolean {
    const normalized = normalize(pattern);

    const matchers = expandBraces(normalized).map(one => {
        // 模式里没有 `/` 时按「任意目录下的这个文件名」理解：模型写 `*.ts` 的意图
        // 几乎总是「所有 ts 文件」，而不是「工作区根目录下的 ts 文件」。
        const effective = one.includes('/') ? one : `**/${one}`;
        return compileSingle(effective);
    });

    return (path: string) => {
        const target = normalize(path);
        return matchers.some(matcher => matcher.test(target));
    };
}

/** 单次匹配（内部会每次编译，循环里请用 compileGlob） */
export function matchesGlob(path: string, pattern: string): boolean {
    return compileGlob(pattern)(path);
}

/**
 * 文件名过滤：不带通配符时按前缀匹配，带通配符时按通配符匹配。
 *
 * 这是 `list_files.pattern` 的语义。前缀那条是历史行为（"test_" 匹配
 * "test_*.ts"），保留它是因为它已经是模型见过的约定；而带通配符时再做前缀
 * 匹配就会变成纯粹的错误来源 —— 传 "*.ts" 一条都匹配不到，然后模型开始怀疑
 * 目录是空的。
 */
export function matchesNamePattern(name: string, pattern: string): boolean {
    if (!hasWildcard(pattern)) return name.startsWith(pattern);
    return matchesGlob(name, pattern);
}
