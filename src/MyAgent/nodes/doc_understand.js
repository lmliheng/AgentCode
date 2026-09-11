/**
 * @nodes/doc_understand.js
 * 节点1：文档理解
 * 职责：读取用户粘贴的项目文档，提取项目信息（目标/技术栈/功能模块），
 *      并做可行性 / 可靠性分析，输出到 State.analysis。
 *
 * 教学要点：LLM 结构化输出用 withStructuredOutput + zod schema，
 * 保证返回的 JSON 一定合法，替代手写 JSON 的脆弱解析。
 */
import { ChatDeepSeek } from "@langchain/deepseek";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

/** 文档理解的结构化输出 schema */
export const analysisSchema = z.object({
  project_info: z.object({
    name: z.string().describe("项目名称"),
    goal: z.string().describe("项目目标"),
    tech_stack: z.array(z.string()).describe("技术栈"),
    modules: z.array(z.string()).describe("功能模块列表"),
  }),
  feasibility: z.object({
    score: z.number().min(0).max(10).describe("可行性评分 0-10"),
    conclusion: z.string().describe("可行性结论"),
  }),
  reliability: z.object({
    score: z.number().min(0).max(10).describe("可靠性评分 0-10"),
    conclusion: z.string().describe("可靠性结论"),
  }),
  risks: z.array(z.string()).describe("潜在风险列表"),
  feasible: z.boolean().describe("是否存在严重问题导致无法按文档开发（如需求矛盾、技术不可实现）"),
  blockers: z.array(z.string()).describe("严重问题列表；没有严重问题时为空数组"),
});

const SYSTEM_PROMPT = `你是一名资深软件架构师。用户会给你一份项目需求文档。

你的任务：
1. 提取项目信息：名称、目标、技术栈、功能模块。
2. 评估可行性：文档描述的需求能否实现？是否存在矛盾、缺失关键信息、技术栈不可实现等严重问题？
3. 评估可靠性：文档对错误处理、边界情况、非功能性需求的覆盖程度如何？
4. 列出风险与严重问题（blockers）。

输出规则：
- 只输出一个 JSON 对象，字段名必须与下面结构完全一致（不要改名、不要增减字段）：
{
  "project_info": { "name": "项目名称", "goal": "项目目标", "tech_stack": ["技术栈"], "modules": ["功能模块"] },
  "feasibility": { "score": 0-10 之间的数字, "conclusion": "可行性结论" },
  "reliability": { "score": 0-10 之间的数字, "conclusion": "可靠性结论" },
  "risks": ["潜在风险"],
  "feasible": true 或 false,
  "blockers": ["严重问题；没有则为空数组"]
}
- feasible=false 仅当存在无法继续开发的严重问题；一般性疑问不算。`;

/**
 * 创建文档理解节点
 * @param {ChatDeepSeek} model 已配置的 ChatDeepSeek 实例
 */
export function createDocUnderstandNode(model) {
  // DeepSeek thinking 模式不支持强制 tool_choice，用 jsonMode 结构化输出
  const structured = model.withStructuredOutput(analysisSchema, {
    method: "jsonMode",
  });

  return async (state) => {
    console.log("\n────────────────────────");
    console.log("[文档理解] 正在分析项目文档…");
    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(state.project_doc),
    ];
    // jsonMode 可能字段名漂移，失败时重试一次（把反例带给模型）
    let res;
    try {
      res = await structured.invoke(messages);
    } catch (e1) {
      console.log("[文档理解] 首次输出不合法，重试…");
      res = await structured.invoke([
        ...messages,
        new HumanMessage(
          `注意：你上次的输出不符合字段要求（${e1?.message?.slice(0, 80)}）。请严格按下述 JSON 结构输出，字段名一个都不能改：${JSON.stringify(analysisSchema.shape, null, 2)}`
        ),
      ]);
    }
    console.log(
      `[文档理解] 项目「${res.project_info.name}」 可行性 ${res.feasibility.score}/10，可靠性 ${res.reliability.score}/10`
    );
    return { analysis: res };
  };
}
