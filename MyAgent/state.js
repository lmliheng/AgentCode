/**
 * @state.js
 * CodingAgent 的两套 State schema：
 *  - CodingAgentState：外层流程图状态（流程节点间传递）
 *  - DevState：内层 ReAct 子图状态（开发循环专用）
 *
 * 教学要点：Annotation 定义字段 + reducer 决定"节点返回的更新如何合并进 State"。
 *  - reducer (x, y) => y ?? x  表示"后写的覆盖先写的"（单值字段）
 *  - reducer (x, y) => x.concat(y) 表示"追加"（数组字段，如消息、任务）
 */
import { Annotation } from "@langchain/langgraph";

/** 消息累积 reducer：节点返回单条或数组消息都追加到末尾 */
const messagesReducer = (x, y) => {
  return x.concat(Array.isArray(y) ? y : [y]);
};

/** 单值覆盖 reducer：后写的值覆盖先写的（undefined 不算更新） */
const overwrite = (x, y) => (y ?? x);

/**
 * 外层 CodingAgentState
 * 对应 README 流程：文档 → 分析 → 遗漏确认 → 计划 → 逐任务开发 → 反馈
 */
export const CodingAgentState = Annotation.Root({
  /** 用户粘贴的项目文档（节点1 的输入） */
  project_doc: Annotation({
    reducer: overwrite,
    default: () => "",
  }),
  /** 文档理解节点输出：{ project_info, feasibility, reliability, risks, feasible, blockers } */
  analysis: Annotation({
    reducer: overwrite,
    default: () => null,
  }),
  /** 遗漏分析节点当轮输出的遗漏点数组 */
  missing_points: Annotation({
    reducer: overwrite,
    default: () => [],
  }),
  /** 遗漏分析已进行的轮数（上限 3 轮） */
  missing_round: Annotation({
    reducer: (x, y) => (x ?? 0) + (y ?? 1),
    default: () => 0,
  }),
  /** 用户对每个遗漏点的拍板：{ [module]: 用户选择 } */
  decisions: Annotation({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({}),
  }),
  /** Plan 节点输出：{ tasks: [...] } */
  plan: Annotation({
    reducer: overwrite,
    default: () => null,
  }),
  /** 任务队列（README 的 task JSON，含 revision 修改记录字段） */
  tasks: Annotation({
    reducer: overwrite,
    default: () => [],
  }),
  /** 当前正在开发的任务下标 */
  task_index: Annotation({
    reducer: overwrite,
    default: () => 0,
  }),
  /** 当前任务（开发子图的输入） */
  current_task: Annotation({
    reducer: overwrite,
    default: () => null,
  }),
  /** 开发子图完成后的结果摘要 { files, summary } */
  current_result: Annotation({
    reducer: overwrite,
    default: () => null,
  }),
  /**
   * 开发子图的 ReAct 消息历史（"修改"重跑时带上下文）
   * 用覆盖式 reducer：develop 节点自行决定消息起点
   * （新任务重新构造 / 修改时带上一次历史 + 修改意见），
   * 返回完整最新数组直接覆盖，避免累积陈旧消息。
   */
  dev_messages: Annotation({
    reducer: overwrite,
    default: () => [],
  }),
  /** 用户反馈：'Y' | 'MODIFY' | 'TERMINATE' */
  feedback: Annotation({
    reducer: overwrite,
    default: () => null,
  }),
  /** 用户"修改"时输入的修改意见 */
  modify_message: Annotation({
    reducer: overwrite,
    default: () => null,
  }),
  /** 是否终止整个流程 */
  terminated: Annotation({
    reducer: overwrite,
    default: () => false,
  }),
  /** 外层对话流（供文档理解/遗漏分析/Plan 使用，LangChain 消息） */
  messages: Annotation({
    reducer: messagesReducer,
    default: () => [],
  }),
});

/**
 * 内层 DevState（ReAct 子图专用）
 * 与外层隔离：开发循环的中间消息不污染全局状态
 */
export const DevState = Annotation.Root({
  /** ReAct 对话流（LangChain 消息，reducer 累积 + 窗口截断） */
  messages: Annotation({
    reducer: messagesReducer,
    default: () => [],
  }),
  /** 当前任务定义 */
  task: Annotation({
    reducer: overwrite,
    default: () => null,
  }),
  /** 步数计数：agent 每转一圈 +1，条件边限 15 步 */
  step: Annotation({
    reducer: (x, y) => (x ?? 0) + (y ?? 1),
    default: () => 0,
  }),
  /** 开发结果摘要 { files, summary } */
  result: Annotation({
    reducer: overwrite,
    default: () => null,
  }),
});
