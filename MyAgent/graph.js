/**
 * @graph.js
 * CodingAgent 图组装：外层流程图 + 内层 ReAct 子图（嵌套图，决策 3）
 *
 * 外层图：
 *   START → collect_doc(interrupt 粘贴文档)
 *        → doc_understand(提取信息 + 可行性/可靠性分析)
 *        → [feasible=false] → feasibility_gate(interrupt 继续/补文档/终止)
 *        → missing_analysis(LLM 找遗漏) → [有遗漏] → ask_missing(interrupt 逐个问) → 循环 ≤3 轮
 *        → plan(生成任务队列) → develop(内嵌 ReAct 子图) → feedback(interrupt Y/修改/终止)
 *        → 条件边：Y 下一任务 / 修改重跑当前 / 终止 END
 *
 * 编译时挂 MemorySaver（决策 4），支持 interrupt 断点恢复。
 */
import { StateGraph, START, END, MemorySaver, interrupt } from "@langchain/langgraph";
import { ChatDeepSeek } from "@langchain/deepseek";
import { CodingAgentState } from "./state.js";
import { createDocUnderstandNode } from "./nodes/doc_understand.js";
import { feasibilityGate } from "./nodes/feasibility_gate.js";
import {
  createMissingAnalysisNode,
  askMissing,
  MAX_MISSING_ROUNDS,
} from "./nodes/missing_analysis.js";
import { createPlanNode } from "./nodes/plan.js";
import { createDevelopNode } from "./nodes/develop.js";
import { feedbackNode } from "./nodes/feedback.js";
import { createFsTools } from "./tools/fs_tools.js";

/** 模型实例（全面 LangChain 化，决策 2/18：全程 thinking） */
export function createModel() {
  const options = {
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    // 决策 18：全程开启 DeepSeek thinking
    // ChatDeepSeek 不支持显式 thinking 构造参数，通过 modelKwargs 透传到请求体
    modelKwargs: { thinking: { type: "enabled" } },
  };
  if (process.env.DEEPSEEK_BASE_URL) {
    // OpenAI 兼容客户端用 configuration.baseURL 指定自定义 API 地址
    options.configuration = { baseURL: process.env.DEEPSEEK_BASE_URL };
  }
  return new ChatDeepSeek(options);
}

/**
 * collect_doc 节点：interrupt 收集用户粘贴的项目文档
 * 若已从记忆恢复 project_doc（决策 12），直接跳过
 */
async function collectDoc(state) {
  if (state.project_doc) {
    console.log("[文档] 已从记忆恢复项目文档，跳过粘贴");
    return {};
  }
  const doc = interrupt({ kind: "collect_doc" });
  return { project_doc: doc };
}

/**
 * 构建完整 CodingAgent
 * @param {object} opts
 * @param {string} opts.workdir 工作目录（文件工具的 root）
 */
export function buildGraph({ workdir }) {
  const model = createModel();
  const tools = createFsTools(workdir);
  const checkpointer = new MemorySaver();

  const builder = new StateGraph(CodingAgentState)
    .addNode("collect_doc", collectDoc)
    .addNode("doc_understand", createDocUnderstandNode(model))
    .addNode("feasibility_gate", feasibilityGate)
    .addNode("missing_analysis", createMissingAnalysisNode(model))
    .addNode("ask_missing", askMissing)
    .addNode("plan_tasks", createPlanNode(model))
    .addNode("develop", createDevelopNode(model, tools))
    .addNode("feedback_loop", feedbackNode)

    .addEdge(START, "collect_doc")
    .addEdge("collect_doc", "doc_understand")

    // 可行性门：严重问题 → 暂停询问；否则进遗漏分析
    .addConditionalEdges(
      "doc_understand",
      (s) => (s.analysis?.feasible === false ? "feasibility_gate" : "missing_analysis"),
      { feasibility_gate: "feasibility_gate", missing_analysis: "missing_analysis" }
    )
    .addConditionalEdges(
      "feasibility_gate",
      (s) => {
        if (s.terminated) return END;
        return s.project_doc ? "missing_analysis" : "collect_doc";
      },
      { [END]: END, missing_analysis: "missing_analysis", collect_doc: "collect_doc" }
    )

    // 遗漏分析循环：有遗漏且未达轮数上限 → 逐个问；否则进 Plan
    // 注意用 <=：第 3 轮（missing_round=3）发现的遗漏也要问完，
    // 第 4 轮 missing_round=4 才进 Plan（即最多询问 3 轮）
    .addConditionalEdges(
      "missing_analysis",
      (s) =>
        s.missing_points.length > 0 && s.missing_round <= MAX_MISSING_ROUNDS
          ? "ask_missing"
          : "plan_tasks",
      { ask_missing: "ask_missing", plan_tasks: "plan_tasks" }
    )
    .addEdge("ask_missing", "missing_analysis")

    .addEdge("plan_tasks", "develop")
    .addEdge("develop", "feedback_loop")

    // 反馈路由：终止 → END；修改 → 重跑当前任务；Y → 有剩余任务继续，否则 END
    .addConditionalEdges(
      "feedback_loop",
      (s) => {
        if (s.terminated) return END;
        if (s.feedback === "MODIFY") return "develop";
        return s.task_index < s.tasks.length ? "develop" : END;
      },
      { [END]: END, develop: "develop" }
    );

  const graph = builder.compile({ checkpointer });

  return { graph, checkpointer, model, tools };
}
