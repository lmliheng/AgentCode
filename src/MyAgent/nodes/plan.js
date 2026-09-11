/**
 * @nodes/plan.js
 * 节点3：Plan-and-Execute
 * 职责：基于项目文档 + 可行性分析 + 用户已确认的遗漏决策，
 *      生成任务队列（README 的 task JSON 格式），存进 State.tasks。
 *
 * 若 State 已存在任务（从 memory.json 恢复），跳过直接继续开发。
 */
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

/** 单个任务 schema（README 格式 + revision 字段） */
export const taskSchema = z.object({
  task_id: z.string().describe("任务编号，如 T01"),
  module: z.string().describe("所属模块"),
  goal: z.string().describe("任务目标（一句话）"),
  inputs: z.array(z.string()).describe("输入/前置依赖"),
  outputs: z.array(z.string()).describe("预期产出"),
  core_files: z.array(z.string()).describe("预计创建/修改的核心文件路径"),
  acceptance_criteria: z.array(z.string()).describe("验收标准"),
});

/** Plan 的结构化输出 schema */
export const planSchema = z.object({
  tasks: z.array(taskSchema).describe("开发任务队列（按实现顺序排列）"),
});

const SYSTEM_PROMPT = `你是一名资深技术负责人。基于项目文档、初步分析和用户已确认的设计决策，把开发工作拆解成一个有序的任务队列。

要求：
1. 每个任务聚焦一个可独立完成的功能点，粒度适中（能在有限步骤内完成）。
2. 按依赖顺序排列：前置任务在前。
3. core_files 给出预计创建/修改的文件相对路径。
4. 任务数量 1~8 个之间。

输出规则：
- 只输出一个 JSON 对象，字段名必须与下面结构完全一致：
{
  "tasks": [
    {
      "task_id": "T01",
      "module": "所属模块",
      "goal": "任务目标",
      "inputs": ["输入/前置依赖"],
      "outputs": ["预期产出"],
      "core_files": ["预计创建/修改的文件相对路径"],
      "acceptance_criteria": ["验收标准"]
    }
  ]
}`;

/**
 * 创建 Plan 节点
 * @param {import("@langchain/deepseek").ChatDeepSeek} model
 */
export function createPlanNode(model) {
  // DeepSeek thinking 模式不支持强制 tool_choice，用 jsonMode 结构化输出
  const structured = model.withStructuredOutput(planSchema, {
    method: "jsonMode",
  });

  return async (state) => {
    // 已有任务（记忆恢复）则跳过
    if (state.tasks.length > 0) {
      console.log(`[计划] 已有 ${state.tasks.length} 个任务（来自记忆），跳过重新规划`);
      return { plan: { tasks: state.tasks }, tasks: state.tasks };
    }

    console.log("\n────────────────────────");
    console.log("[计划] 正在生成任务队列…");
    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(
        JSON.stringify(
          {
            project_doc: state.project_doc,
            analysis: state.analysis,
            decisions: state.decisions,
          },
          null,
          2
        )
      ),
    ];
    // jsonMode 可能字段名漂移，失败时重试一次
    let res;
    try {
      res = await structured.invoke(messages);
    } catch (e1) {
      console.log("[计划] 首次输出不合法，重试…");
      res = await structured.invoke([
        ...messages,
        new HumanMessage(
          `注意：你上次的输出不符合字段要求（${e1?.message?.slice(0, 80)}）。请严格按任务结构输出：{"tasks": [{"task_id": "T01", "module": "模块", "goal": "目标", "inputs": [], "outputs": [], "core_files": [], "acceptance_criteria": []}]}`
        ),
      ]);
    }
    console.log(`[计划] 生成 ${res.tasks.length} 个任务：`);
    for (const t of res.tasks) {
      console.log(`  - ${t.task_id} [${t.module}] ${t.goal}`);
    }
    return { plan: res, tasks: res.tasks };
  };
}
