// src/tools/deferred.ts
//
// 常驻工具 / 延迟工具的划分。
//
// 独立成模块，是因为有两处必须用同一套判定：注册表（要回答 tool_search「有哪些延迟工具」）
// 与运行时（要决定下发哪些声明、要在系统提示里列延迟清单）。而 ToolRegistry 与
// ToolSearchTool 互相引用，把常量或判定放在任一方都会形成循环导入。
//
// 语义参考 qwen-code 的 `tools.eager`：列进白名单的工具 schema 随首轮请求下发；
// 未列出的（非豁免）工具**仍然注册、仍然能执行**，只是 schema 不进请求，
// 模型改用 tool_search 取 schema、tool_call 调用。

import type { Tool } from '../types/Tool.js';

/** 检索延迟工具的声明，不改动当前的工具列表 */
export const TOOL_SEARCH = 'tool_search';

/** 调用延迟工具（schema 先经 tool_search 看过） */
export const TOOL_CALL = 'tool_call';

/**
 * 桥工具永远常驻，且豁免于白名单。
 *
 * 延迟工具之所以「延迟但可用」，靠的就是这两个入口。任一缺失，被延迟的工具就
 * 既看不到也够不到——qwen-code 的 settings 文档把这种状态写成「白名单仍然扣下
 * schema，但没有任何东西能把它们加载回来」。
 */
export const BRIDGE_TOOL_NAMES: readonly string[] = [TOOL_SEARCH, TOOL_CALL];

export function isBridgeTool(name: string): boolean {
  return BRIDGE_TOOL_NAMES.includes(name);
}



export interface DeclaredToolSplit {
  /** 常驻：schema 随首轮请求下发 */
  eager: Tool[];
  /** 延迟：已注册、可执行，但 schema 不进请求 */
  deferred: Tool[];
  /** 白名单里写了、却不在工具集合里的名字（拼错或工具改名时会出现在这里） */
  unknownNames: string[];
}



/**
 * 按常驻白名单切分工具。
 *
 * `eagerAllowList` 为 undefined 表示**不限制**——全部常驻。这与 qwen-code 的
 * `tools.eager` 默认语义一致（omit the setting means no restriction），
 * 也让未配置白名单的调用方（现有测试）行为不变。
 */
export function splitDeclaredTools(
  tools: readonly Tool[],
  eagerAllowList: readonly string[] | undefined,
): DeclaredToolSplit {
  if (eagerAllowList === undefined) {
    return { eager: [...tools], deferred: [], unknownNames: [] };
  }

  const allowed = new Set(eagerAllowList);
  const known = new Set(tools.map((tool) => tool.name));

  return {
    eager: tools.filter((tool) => isBridgeTool(tool.name) || allowed.has(tool.name)),
    deferred: tools.filter((tool) => !isBridgeTool(tool.name) && !allowed.has(tool.name)),
    // 拼错的名字在这里被捕获。qwen-code 只把它写进 debug 日志，默认不可见，
    // 于是「配置写错了」和「配置生效了」在表面上没有区别。
    unknownNames: [...allowed].filter((name) => !known.has(name)),
  };
}
