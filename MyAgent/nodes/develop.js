/**
 * @nodes/develop.js
 * 节点4：开发（内嵌 ReAct 子图）
 *
 * 结构（决策 3：嵌套图）：
 *   外层 develop 节点 = 从任务队列取当前任务 → 组装消息 → invoke 子图
 *   内层 ReAct 子图（DevState）：
 *     agent（ChatDeepSeek.bindTools(fs工具) 推理）
 *       → 有 tool_calls → tools（ToolNode 执行）→ 回 agent
 *       → 无 tool_calls（最终回答）→ 提取 result → END
 *     step 计数 + 条件边限 15 步（决策 14）
 *
 * 上下文（决策 15/17）：
 *   - "修改"重跑：带上一次 dev_messages + 追加修改意见
 *   - 窗口截断：messages 保留最近 30 条（决策 17）
 */
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { StateGraph, START, END } from "@langchain/langgraph";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { DevState } from "../state.js";

/** 开发子图最大步数（决策 14） */
export const MAX_DEV_STEPS = 15;
/** 消息窗口大小（决策 17） */
const WINDOW = 30;

const DEV_SYSTEM_PROMPT = `你是一名软件工程师，负责完成指定的开发任务。

工作方式：
1. 用工具在工作目录内读写文件来实现任务目标。
2. 先读取/查看必要文件了解现状，再写代码。
3. 任务说明中的验收标准必须逐条满足。
4. 全部完成后，用一段总结回复：说明实现了什么、创建/修改了哪些文件、如何验证。

规则：
- 只能操作工作目录内的文件（工具会校验）。
- 不要虚构已完成的步骤，所有文件操作必须通过工具真实执行。`;

/**
 * 组装任务的开发说明（含用户已确认的设计决策与修改意见）
 */
function buildTaskBrief(task, decisions) {
  const parts = [
    `任务编号：${task.task_id}`,
    `模块：${task.module}`,
    `目标：${task.goal}`,
    `输入/前置：${task.inputs.join("、")}`,
    `预期产出：${task.outputs.join("、")}`,
    `预计核心文件：${task.core_files.join("、")}`,
    `验收标准：`,
    ...task.acceptance_criteria.map((c) => `  - ${c}`),
  ];
  if (task.revision) {
    parts.push(`历史修改意见（本次必须解决）：${task.revision}`);
  }
  if (decisions && Object.keys(decisions).length > 0) {
    parts.push(`用户已确认的设计决策：\n${JSON.stringify(decisions, null, 2)}`);
  }
  return parts.join("\n");
}

/**
 * 消息窗口截断：保留开头（system + 任务说明）和最近若干条
 */
function truncateMessages(messages, keep) {
  if (messages.length <= keep) return messages;
  const head = messages.slice(0, 2); // system + 首个任务说明
  return [...head, ...messages.slice(-(keep - head.length))];
}

/**
 * 创建子图 agent 节点
 */
function createAgentNode(model, tools) {
  const bound = model.bindTools(tools);
  return async (state) => {
    const msgs = truncateMessages(state.messages, WINDOW);
    const res = await bound.invoke(msgs);
    const hasToolCalls = res.tool_calls && res.tool_calls.length > 0;
    if (!hasToolCalls) {
      // 最终回答：提取开发结果摘要
      return {
        messages: [res],
        step: 1,
        result: {
          task_id: state.task?.task_id,
          module: state.task?.module,
          files: state.task?.core_files ?? [],
          summary: typeof res.content === "string" ? res.content : JSON.stringify(res.content),
        },
      };
    }
    return { messages: [res], step: 1 };
  };
}

/**
 * 子图条件路由：有 tool_calls → tools；达到步数上限或已收尾 → END
 */
function routeAfterAgent(state) {
  if (state.step >= MAX_DEV_STEPS) return END;
  const last = state.messages[state.messages.length - 1];
  return last?.tool_calls?.length ? "tools" : END;
}

/**
 * 创建外层 develop 节点（内嵌 ReAct 子图）
 * @param {import("@langchain/deepseek").ChatDeepSeek} model
 * @param {Array} tools fs 工具集
 */
export function createDevelopNode(model, tools) {
  const subgraph = new StateGraph(DevState)
    .addNode("agent", createAgentNode(model, tools))
    .addNode("tools", new ToolNode(tools))
    .addEdge(START, "agent")
    .addConditionalEdges("agent", routeAfterAgent, {
      tools: "tools",
      [END]: END,
    })
    .addEdge("tools", "agent")
    .compile();

  return async (state) => {
    const task = state.tasks[state.task_index];
    if (!task) {
      console.log("[开发] 没有待开发任务");
      return {};
    }

    console.log("\n────────────────────────");
    console.log(`[开发] 任务 ${task.task_id}（${task.module}）：${task.goal}`);

    let messages;
    if (state.modify_message && state.dev_messages.length > 0) {
      // "修改"重跑：带上下文 + 追加修改意见（决策 15）
      messages = [
        ...state.dev_messages,
        new HumanMessage(`用户的修改意见：${state.modify_message}`),
      ];
      console.log(`[开发] 带上下文重跑（修改意见：${state.modify_message.slice(0, 40)}…）`);
    } else {
      // 新任务：全新上下文
      messages = [
        new SystemMessage(DEV_SYSTEM_PROMPT),
        new HumanMessage(buildTaskBrief(task, state.decisions)),
      ];
    }

    const out = await subgraph.invoke({ messages, task, step: 0 });
    console.log(`[开发] ${task.task_id} 结束（共 ${out.messages.length} 条消息）`);
    return {
      current_task: task,
      current_result: out.result,
      dev_messages: out.messages,
    };
  };
}
