/**
 * @nodes/feasibility_gate.js
 * 可行性门节点
 * 职责：文档理解分析出严重问题（feasible=false）时，
 *       interrupt 暂停询问用户：继续 / 补充文档重来 / 终止。
 *
 * 教学要点：interrupt 暂停后，CLI 层收集用户输入，
 * 用 Command({ resume }) 恢复执行，本节点拿到 decision 继续。
 */
import { interrupt } from "@langchain/langgraph";

/**
 * 可行性门节点
 * @param {object} state 外层 State
 * @returns {object} 状态更新
 */
export async function feasibilityGate(state) {
  const decision = interrupt({
    kind: "feasibility_gate",
    analysis: state.analysis,
  });

  // decision: 'continue' | 'reprovide' | 'terminate'
  if (decision === "terminate") {
    return { terminated: true };
  }
  if (decision === "reprovide") {
    // 清空文档与分析，回到 collect_doc 重新粘贴
    return {
      project_doc: "",
      analysis: null,
      missing_points: [],
      missing_round: 0,
    };
  }
  // 'continue'：带着风险继续
  return {};
}
