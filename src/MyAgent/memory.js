/**
 * @memory.js
 * 轻量本地文件存档（长期记忆 MVP）：
 *  - 会话结束把 decisions / plan / tasks / 反馈记录 存成 workspace/memory.json
 *  - 下次启动可选加载继续
 *
 * RAG 知识记忆（向量检索）留后续迭代。
 */
import fs from "node:fs/promises";
import path from "node:path";

/** 记忆文件名（放在工作目录下） */
export const MEMORY_FILE = "memory.json";

/**
 * 保存会话记忆到工作目录
 * @param {string} workdir 工作目录
 * @param {object} data 要存档的状态子集
 */
export async function saveMemory(workdir, data) {
  try {
    const file = path.join(workdir, MEMORY_FILE);
    await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
    return file;
  } catch (e) {
    console.error(`[memory] 存档失败：${e.message}`);
    return null;
  }
}

/**
 * 加载工作目录里已存的记忆（没有则返回 null）
 * @param {string} workdir 工作目录
 * @returns {Promise<object|null>}
 */
export async function loadMemory(workdir) {
  try {
    const file = path.join(workdir, MEMORY_FILE);
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 从完整 State 中挑出值得存档的字段（不存消息历史，控制体积）
 */
export function pickMemory(state) {
  return {
    saved_at: new Date().toISOString(),
    project_doc: state.project_doc,
    analysis: state.analysis,
    decisions: state.decisions,
    plan: state.plan,
    tasks: state.tasks,
    task_index: state.task_index,
    terminated: state.terminated,
  };
}
