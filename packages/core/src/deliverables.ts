// src/deliverables.ts
//
// 交付物声明的收敛。
//
// 声明有两个来路（模型在计划里报的、调用方钉死的），两处都要过同一套收敛，
// 否则「模型声明」和「配置声明」会在验收里表现出两种脾气。

import type { DeliverableSpec } from './types/ReAct.js';

/**
 * 把原始声明收敛成可核对的断言。
 *
 * 这里只做**形状**收敛：丢掉空路径、丢掉重复项、把裸字符串写法（模型常见的偷懒形式）
 * 归一成对象。**合法性**（是否落在工作区内、是否真的是文件）一律不在这里判 ——
 * 静默丢掉一条越界声明，验收时就没人知道它被声明过；交给验收逐条给出结论，
 * 「路径不合法」会作为一条不通过的核对结果显示出来。
 */
export function normalizeDeliverables(raw: unknown): DeliverableSpec[] {
    if (!Array.isArray(raw)) return [];

    const specs: DeliverableSpec[] = [];
    const seen = new Set<string>();

    for (const entry of raw) {
        const record = entry && typeof entry === 'object' && !Array.isArray(entry)
            ? (entry as Record<string, unknown>)
            : null;

        const path = typeof entry === 'string'
            ? entry.trim()
            : (typeof record?.path === 'string' ? record.path.trim() : '');
        if (path === '' || seen.has(path)) continue;
        seen.add(path);

        const contains = typeof record?.contains === 'string' ? record.contains : '';
        specs.push(contains === '' ? { path } : { path, contains });
    }

    return specs;
}
