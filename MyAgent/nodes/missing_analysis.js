/**
 * @nodes/missing_analysis.js
 * 节点2：遗漏分析（含两个子节点：missing_analysis + ask_missing）
 *
 * 流程（决策 6：数组输出 + 逐个 interrupt + 循环查漏 ≤3 轮）：
 *   missing_analysis：LLM 基于文档+分析+已确认决策，输出遗漏点数组
 *        ↓ 非空且轮数 < 3
 *   ask_missing：逐个 interrupt 问用户（3 选项 + 自定义），记录 decisions
 *        ↓
 *   回到 missing_analysis 再查一轮（带上已确认决策，避免重复提问）
 *        ↓ 空数组或达 3 轮 → 进 plan
 *
 * 教学要点：interrupt 放在没有 LLM 调用的 ask_missing 节点，
 * 恢复重执行时无副作用（幂等），不会浪费模型调用。
 */
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import { z } from "zod";

/** 单个遗漏点 schema（3 个候选选项，不含"自定义"，由 CLI 层追加） */
export const missingPointSchema = z.object({
  module: z.string().describe("遗漏点所属模块或主题"),
  question: z.string().describe("需要用户拍板的设计问题"),
  options: z.array(z.string()).describe("3 个候选设计选项"),
});

/** 遗漏分析的结构化输出 schema */
export const missingAnalysisSchema = z.object({
  missing_points: z
    .array(missingPointSchema)
    .describe("本轮发现的设计遗漏点清单；若没有遗漏则为空数组"),
});

/** 遗漏分析最大轮数（决策 6） */
export const MAX_MISSING_ROUNDS = 3;

const SYSTEM_PROMPT = `你是一名需求分析师。给定项目文档、初步分析结果和用户已确认的设计决策，找出文档中仍然缺失、需要用户拍板的设计点。

遗漏点类型示例（不限于）：
- 未指定的技术选型（认证方案、数据库、消息队列…）
- 未定义的权限模型 / 用户角色
- 未处理的边界情况 / 错误处理策略
- 明确但有两种以上合理做法的设计

规则：
1. 每个遗漏点给 1 个清晰问题 + 3 个具体候选选项。
2. 用户已经确认过的决策（见 decisions）不要重复提出。
3. 已在前几轮提出并确认过的不要再次提出。
4. 若没有新的遗漏点，返回空数组。

输出规则：
- 只输出一个 JSON 对象，字段名必须与下面结构完全一致：
{
  "missing_points": [
    { "module": "所属模块或主题", "question": "需要用户拍板的问题", "options": ["选项1", "选项2", "选项3"] }
  ]
}
- 没有遗漏时："missing_points": []`;

/**
 * 组装遗漏分析的上下文提示（文档 + 分析 + 已确认决策）
 */
function buildContext(state) {
  return JSON.stringify(
    {
      project_doc: state.project_doc,
      analysis: state.analysis,
      decisions: state.decisions,
      missing_round: state.missing_round,
    },
    null,
    2
  );
}

/**
 * 创建遗漏分析节点（纯 LLM，无 interrupt）
 */
export function createMissingAnalysisNode(model) {
  // DeepSeek thinking 模式不支持强制 tool_choice，用 jsonMode 结构化输出
  const structured = model.withStructuredOutput(missingAnalysisSchema, {
    method: "jsonMode",
  });

  return async (state) => {
    console.log("\n────────────────────────");
    console.log("[遗漏分析] 第 " + (state.missing_round + 1) + " 轮查漏…");
    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(buildContext(state)),
    ];
    // jsonMode 可能字段名漂移，失败时重试一次
    let res;
    try {
      res = await structured.invoke(messages);
    } catch (e1) {
      console.log("[遗漏分析] 首次输出不合法，重试…");
      res = await structured.invoke([
        ...messages,
        new HumanMessage(
          `注意：你上次的输出不符合字段要求（${e1?.message?.slice(0, 80)}）。请严格按下述结构输出：{"missing_points": [{"module": "模块", "question": "问题", "options": ["选项1","选项2","选项3"]}]}`
        ),
      ]);
    }
    if (res.missing_points.length === 0) {
      console.log("[遗漏分析] 无新增遗漏点");
    } else {
      console.log(`[遗漏分析] 发现 ${res.missing_points.length} 个遗漏点`);
    }
    return { missing_points: res.missing_points, missing_round: 1 };
  };
}

/**
 * ask_missing 节点：逐个 interrupt 询问用户（幂等，无 LLM 调用）
 */
export async function askMissing(state) {
  const decisions = {};
  for (const mp of state.missing_points) {
    const answer = interrupt({
      kind: "missing_point",
      module: mp.module,
      question: mp.question,
      options: [...mp.options, "自定义"],
    });
    decisions[mp.module] = answer;
  }
  return { decisions };
}
