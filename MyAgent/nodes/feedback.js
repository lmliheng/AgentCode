/**
 * @nodes/feedback.js
 * 节点5：反馈
 * 职责：展示当前任务开发结果（模块/文件/核心代码摘要/验证方式），
 *       interrupt 询问用户：Y（继续下一任务）/ 修改（输入意见重跑）/ 终止。
 *
 * 教学要点：反馈节点是流程的控制点，
 * 通过条件边把用户的三个选择路由到不同去向。
 */
import { interrupt } from "@langchain/langgraph";

/**
 * 反馈节点
 * @param {object} state 外层 State
 * @returns {object} 状态更新（Y: 推进任务下标；MODIFY: 记录修改意见；TERMINATE: 终止）
 */
export async function feedbackNode(state) {
  const answer = interrupt({
    kind: "feedback",
    task: state.current_task,
    result: state.current_result,
    remaining: state.tasks.length - (state.task_index ?? 0) - 1,
  });

  // answer: 'Y' | { type: 'MODIFY', message } | 'TERMINATE'
  if (answer === "Y") {
    return {
      feedback: "Y",
      task_index: (state.task_index ?? 0) + 1,
      modify_message: null,
    };
  }
  if (answer === "TERMINATE") {
    return { feedback: "TERMINATE", terminated: true };
  }
  // MODIFY
  const message = answer?.message ?? "请根据反馈修改";
  return { feedback: "MODIFY", modify_message: message };
}
