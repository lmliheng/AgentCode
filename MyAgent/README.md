# CodingAgent（MyAgent）

基于 **LangGraph** 的简化 CodingAgent：`文档理解 → 遗漏分析 → Plan-and-Execute → 开发 → 反馈`。
适配 DeepSeek（全面 LangChain 化），MVP 工具集为文件系统读写，长期记忆为本地 JSON 存档。

> 本目录的 `codingAgent.js` 为最初的骨架注释，完整实现见本目录源码与下方设计文档。

## 快速开始

```bash
# 1. 安装依赖（首次）
cd MyAgent && npm install

# 2. 准备 .env（在仓库根目录，已被 .gitignore 排除）
#    DEEPSEEK_API_KEY=sk-xxx
#    DEEPSEEK_MODEL=deepseek-v4-flash   # 可选

# 3. 运行（从仓库根）
npm run agent
# 或在 MyAgent 下
node --env-file=../.env index.js
```

启动后按提示：输入工作目录（回车默认 `./workspace`）→ 粘贴项目文档（空行结束）→
Agent 自动分析 → 逐个确认遗漏点 → 生成计划 → 逐任务开发 → 每任务反馈 `[Y/修改/终止]`。

## 设计决策树（19 项，已确认）

| # | 决策 | 结论 |
|---|---|---|
| 1 | 运行形态 | 终端 CLI 交互式 |
| 2 | LLM 调用 | 全面 LangChain 化（ChatDeepSeek + LangChain 消息） |
| 3 | 图结构 | 外层流程图 + 内层 ReAct 子图（嵌套图） |
| 4 | 人机交互 | interrupt + MemorySaver |
| 5 | State 粒度 | 结构化 State（外层 CodingAgentState + 内层 DevState） |
| 6 | 遗漏分析 | 数组输出 + 逐个 interrupt + 循环查漏 ≤3 轮 |
| 7 | 文档输入 | 用户直接粘贴（空行结束） |
| 8 | 开发工具集 | 仅文件系统读写（MVP 最小集） |
| 9 | 工作目录 | 启动询问，回车默认 ./workspace，工具以此为根 |
| 10 | 文件工具实现 | 自写 3 个 fs 工具（read_file / write_file / list_dir） |
| 11 | 反馈节奏 | 每任务一反馈（Y / 修改 / 终止） |
| 12 | 长期记忆 | 轻量本地文件存档 memory.json，启动可选加载 |
| 13 | 文档理解输出 | 提取项目信息 + 可行性/可靠性分析 → State.analysis |
| 14 | 开发子图步数 | 15 步上限 |
| 15 | 修改重跑 | 带上下文重跑 + 记录 task.revision |
| 16 | 可行性门 | 严重问题 → interrupt：继续 / 补充文档 / 终止 |
| 17 | 上下文预算 | 窗口截断（开发子图 messages 保留最近 30 条） |
| 18 | Thinking | 全程开启（modelKwargs 透传 thinking） |
| 19 | 依赖/结构 | MyAgent 独立 package.json + 分文件结构 |

## 架构

```
┌─────────────────── 外层图（CodingAgentState）───────────────────┐
│  START → collect_doc(interrupt: 粘贴文档)                        │
│        → doc_understand(LLM: 信息+可行性/可靠性分析)              │
│        → [feasible=false] → feasibility_gate(interrupt: 继续/补文档/终止) │
│        → missing_analysis(LLM: 遗漏数组)                         │
│        → [有遗漏 且 轮数<3] → ask_missing(interrupt 逐个问) → 循环 │
│        → plan_tasks(LLM: 生成任务队列)                            │
│        → develop(内嵌 ReAct 子图) → feedback_loop(interrupt)     │
│             Y→下一任务 / MODIFY→带上下文重跑 / TERMINATE→END       │
└────────────────────────────────────────────────────────────────┘
        ┌────────── 内层 ReAct 子图（DevState）──────────┐
        │  agent(bindTools(fs工具)) → tools(ToolNode) → 循环 │
        │  step 计数，条件边限 15 步                        │
        └────────────────────────────────────────────────┘
```

## 目录结构

```
MyAgent/
  package.json            # 独立依赖：@langchain/langgraph、core、deepseek、zod
  index.js                # CLI 入口：工作目录 → 记忆加载 → 驱动图 → 存档
  debug.js                # 调试工具：--debug 模式（stream updates + history）
  state.js                # CodingAgentState + DevState（Annotation + reducer）
  graph.js                # 外层图 + ReAct 子图组装（compile + MemorySaver）
  memory.js               # memory.json 存档 / 加载
  nodes/
    doc_understand.js     # 节点1：信息提取 + 可行性/可靠性分析
    feasibility_gate.js   # 可行性门（interrupt）
    missing_analysis.js   # 节点2：遗漏分析循环（missing_analysis + ask_missing）
    plan.js               # 节点3：Plan-and-Execute → tasks
    develop.js            # 节点4：开发（内嵌 ReAct 子图，15 步，窗口截断 30 条）
    feedback.js           # 节点5：反馈（Y / 修改 / 终止）
  tools/
    fs_tools.js           # read_file / write_file / list_dir（root 越界校验）
  cli/
    interrupt_ui.js       # interrupt 展示 + 输入收集 + resume 值
  test/
    smoke.js              # 冒烟测试：图构建 + State 字段 + fs 安全（无需 API）
    api.js                # API 连通性：基础对话 + 结构化输出 + 工具循环
    structured.js         # 探测 thinking 下可用的结构化输出方法
    structured2.js        # 验证 jsonMode + bindTools(auto)
    e2e.js                # 端到端：模拟完整会话（真实调用 LLM）
    debug_e2e.js          # 调试模式端到端：验证 stream(updates) + history
    stream_probe.js       # 验证 stream/interrupt/get_state_history 行为
    repro.js              # 最小复现：jsonMode 字段名漂移
    interrupt_resume.js   # 验证 interrupt resume 传值 vs 传数组
```

## 调试指南（看 State 变化）

### 方案 A：`--debug` 实时打印 State 增量（推荐）

```bash
node --env-file=../.env index.js --debug
```

内部用 `graph.stream(..., { streamMode: "updates" })` 替代 `invoke`，
每个节点运行后打印它更新了哪些字段（interrupt 暂停点也会高亮）：

```
▶ 节点 doc_understand 更新 State：analysis: {project_info,feasibility,reliability,risks,feasible,blockers}
▶ 节点 missing_analysis 更新 State：missing_points: [3 项]  missing_round: 1
⏸ interrupt 暂停：kind=missing_point
▶ 节点 ask_missing 更新 State：decisions: {认证方案,错误处理,数据存储}
▶ 节点 plan_tasks 更新 State：plan: {tasks}  tasks: [4 项]
▶ 节点 develop 更新 State：current_task: {task_id,module,...}  current_result: {...}  dev_messages: [12 项]
▶ 节点 feedback_loop 更新 State：feedback: "Y"  task_index: 1
```

### 方案 B：结束后打印 State 历史快照

`--debug` 模式结束后会自动打印 `get_state_history`：
每个节点执行后的完整 State 快照（时间倒序），可复盘整次运行的每一步状态。
例如可以看到 `missing_round` 0→1→2→3→4 的累积、`decisions` 逐步增长、`task_index` 推进。

> 注意：方案 A 的 `stream("updates")` 打印的是**节点返回的增量**（如 `missing_round: 1` 是节点每次返回的 +1），
> 不是 reducer 累积后的实际 State。要看累积后的真实 State，用方案 B 的快照
> 或 `streamMode: "values"`（完整 State）。

### 方案 C：LangSmith（云端全链路追踪）

LangChain 官方可观测平台，零侵入接入（.env 加两行，代码不用改）：

```bash
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=lsv2_xxx    # langsmith.com 注册后免费拿到
```

之后每次运行自动上传 trace：图结构、每节点输入输出、每次 LLM 调用
（prompt/response/token/费用/thinking）、每次工具调用、interrupt 暂停点。
配套能力：Evals 评估、生产监控。替代品：Langfuse（开源可自托管）。

### 原理速记

| API | 作用 |
|---|---|
| `graph.stream(input, { streamMode: "updates" })` | 实时，chunk = `{节点名: 更新的字段}` |
| `graph.stream(input, { streamMode: "values" })` | 实时，chunk = 完整 State |
| `graph.getState(config)` | 当前 State 快照 |
| `graph.getStateHistory(config)` | 每个节点执行后的历史快照（依赖 checkpointer） |
| 节点内 console.log | 已内置（`[文档理解]`、`[开发]` 等） |

## 关键实现说明

### 1. DeepSeek thinking 与结构化输出的兼容（实测结论）

- `modelKwargs: { thinking: { type: "enabled" } }` 可把 thinking 透传到请求体（ChatDeepSeek 无显式参数）。
- **thinking 模式不支持强制 tool_choice**（`withStructuredOutput` 默认 functionCalling 会 400）。
- `jsonSchema` response_format 不可用（400）。
- 因此结构化节点（doc_understand / missing_analysis / plan）统一用 `method: "jsonMode"`，
  并在 system prompt 中写死输出 JSON 字段结构（jsonMode 不下发 schema，模型可能改字段名）。
- 开发子图用 `bindTools`（tool_choice auto），thinking 下可用。

### 2. interrupt 的放置原则

interrupt 放在**没有 LLM 调用的节点**（ask_missing / feedback_loop / collect_doc / feasibility_gate）。
原因：LangGraph 恢复时会重新执行该节点，纯交互节点重执行无副作用（幂等），不浪费模型调用。

### 3. LangGraph 1.x 注意事项

- **节点名不能与 State 字段名重复**（如 plan / feedback 撞名，需改名 plan_tasks / feedback_loop）。
- `Annotation.Root(...)` 返回 `{ lc_graph_name, spec }`，字段在 `.spec` 上。

## LangGraph 概念速查（本项目中的位置）

| 概念 | 含义 | 本项目位置 |
|---|---|---|
| State + Annotation + reducer | 共享黑板，reducer 定义字段如何合并更新 | state.js |
| Node | 执行单元：读 State → 做一件事 → 返回部分更新 | nodes/*.js |
| Conditional Edge | 按 State 内容动态选路 | graph.js（可行性门/遗漏循环/反馈路由/步数上限） |
| interrupt | 图暂停，CLI 收集输入，Command({resume}) 恢复 | 4 个交互节点 + cli/interrupt_ui.js |
| checkpointer | 状态持久化（MemorySaver 内存版） | graph.js compile({ checkpointer }) |
| 子图 | 嵌套图：一个节点内部是完整图 | nodes/develop.js（ReAct 子图） |
| ToolNode | 统一执行模型请求的工具 | nodes/develop.js |
| withStructuredOutput | LLM 结构化输出（jsonMode） | 3 个 LLM 节点 |

## Roadmap（后续迭代）

1. **MCP 适配**：文件工具换 filesystem-mcp 或加 MCP tool 转换器（README 大目标）
2. **RAG 长期记忆**：接入现有 RAG 链路做知识检索
3. **Shell 工具**：跑测试/装依赖，质量闭环
4. **SqliteSaver**：跨进程断点续跑
5. **Context/ContextBudge**：完整上下文预算管理
