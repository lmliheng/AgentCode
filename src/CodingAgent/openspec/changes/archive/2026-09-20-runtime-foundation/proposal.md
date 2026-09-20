# Proposal

## Why

`CodingAgent` 的骨架已成型（Tool 抽象、ReAct 循环、预算与停止条件、12 个原生工具、测试覆盖），但**真实模型一次都跑不通**，存在四处相互掩盖的断点：

- `DeepSeekProvider.decide()` 的实现是单参 `decide(message)`，而接口声明是 `decide(messages, tools)` —— `tools` 被静默丢弃，`requestBody` 里从未出现过工具声明。模型只能靠 system prompt 约定「请输出 JSON」来产生工具调用。
- CLI 路径构造 provider 时未传 `baseUrl`，而实现里是 `fetch(this.config.baseUrl!)` —— 一跑就失败。
- HITL 审批链路挂在 `AgentRuntime` 上一个并不存在的 `requestApproval` 属性上；`executeAction` 里真正使用的 `ctx.requestApproval` 是硬编码 `return 'approve'`；`checkHumanInTheLoop()` 仅打印日志。
- `verifyTask()` 把 `stopReason === 'task_completed'` 等同于验收通过，即「模型自称完成 = 通过」，`typeCheckPassed` 硬编码为 `false`。

另有一处同类缺陷，不阻断运行但同样长期不可见：Provider 已解析出模型返回的真实 token 用量，运行循环却把它丢弃，运行状态中也没有承载字段，导致交互层读取一个不存在的字段、token 统计永远显示 0。

这些断点长期不可见的根因是测试形态：`MockProvider` 绕过了真实 Provider，`ds.test.ts` 又恰好手动传了 `baseUrl`，于是「真实链路」从未被任何用例覆盖。

因此本 change 的目标不是新增功能，而是**让地基可验证地跑通一次真实任务**：统一工具调用协议、修好接线、补上客观验收。记忆、沙盒、MCP、CLI 都要叠在这层之上，在此之前投入无法验证。

## What Changes

**1. 工具调用协议归一（BREAKING）**

- `DeepSeekProvider.decide()` 补齐 `tools` 参数并真实下发工具声明。
- 删除 content-JSON 决策路径：`extractJsonFromResponse()`、`validateDecision()`，以及 system prompt 中「请按 JSON 格式输出」的约定。
- 新增 Provider 边界的响应翻译：1 个 `tool_call` → `Action`；N 个 → `BatchAction`；0 个 → `Final`。
- `Final` 由「这一轮没有工具调用」回落产生，**不引入 `final_answer` 工具**。
- `Replan` 通过 `request_replan` 工具表达；`BatchAction` 保留 `batch` 元工具作为兜底（DeepSeek 的并行 `tool_calls` 无官方文档保证）。
- `ModelDecision` 继续作为 Runtime 内部 IR，形状不变。

**2. 真实对话 transcript 与消息序列合法性**

- `buildContextMessages()` / `buildRecentHistory()` 从「把历史决策序列化成 JSON 字符串回放」改为维护真实 `ChatMessage[]`：`assistant.tool_calls` 与 `role:'tool'` 结果成对出现。
- 新增消息序列清理：孤儿 tool call 清理与 tool 结果配对，应对 DeepSeek 官方「Chat Completion API 不支持中途插入 tool calls」的限制。

**3. 接线修复**

- `baseUrl` 提供默认值 `https://api.deepseek.com/v1/chat/completions`；`.env.example` 补充 `DEEPSEEK_BASE_URL`。
- `ToolContext.requestApproval` 的注入点归位，使 `PendingAction` 能真正送达 `ApprovalModal`；移除 `checkHumanInTheLoop()` 的占位实现或将其接入真实审批。

**4. Runtime 独立复验**

- `verifyTask()` 从占位实现改为：Final 之后由 Runtime 推断验证命令（优先 `package.json` 的 test script；存在 `tsconfig.json` 时追加 `tsc --noEmit`），实际执行，并将结果写入 `TaskVerificationResult` 的 `testResults` / `typeCheckPassed` / `diffSummary` / `completionCriteriaMet`。
- 验收不依赖模型自述，也不引入新的工具入口。

**5. 运行状态记录模型用量**

- 运行循环把每轮模型返回的 token 用量累加进运行状态，使累计消耗成为可观测量。
- 用量缺失时 MUST 标记为未知，MUST NOT 静默填 0。
- 修正交互层读取不存在字段导致的 token 统计恒为 0。
- 本项只承载**累计消耗**这一口径。「当前上下文大小」的度量、实测/估算标注与预算阈值属 Phase 1（`context-budget`），不在本次范围。

## Capabilities

### New Capabilities

- `agent-runtime`: ReAct 循环的决策处理、预算与停止条件、真实对话 transcript 的构造与消息序列合法性
- `tool-calling-protocol`: Provider 边界的工具声明下发与响应翻译、控制流工具、终止语义
- `human-approval`: 敏感工具的人工审批链（`PendingAction` 生成、注入、approve/reject 语义）
- `task-verification`: Runtime 独立复验（验证命令推断、执行、结果产出）

### Modified Capabilities

无。项目当前 `openspec/specs/` 为空，本 change 是首个 spec。

## Non-Goals

本 change 明确不涉及：

- 上下文预算与压缩策略（Phase 1，见后续 change `context-budget`）—— 本次仅把历史回放改为真实 transcript，不做智能压缩，也不定义预算阈值
- 工具输出体量控制（Phase 1，见 `context-budget`）—— `run_command` 无上限、`fetch_url` 512KB 口径等问题不在本次加固范围内
- 记忆的短期 / 长期 / 存储设计（Phase 2）
- 沙盒或执行隔离（Phase 3）—— `run_command` 的字符串黑名单现状不在本次加固范围内
- MCP client 适配层（Phase 4）
- CLI 无头模式（Phase 5）

## Impact

- **代码**：`src/types/AgentProvider.ts`、`src/provider/deepseek.provider.ts`、`src/provider/Provider.ts`、`src/runtime/agent.runtime.ts`、`src/cli/composable/useAgent.ts`、`.env.example`
- **测试**：`src/test/integration/ds_provider.test.ts` 的 6 个用例重写（当前全部在测 content-JSON 路径）；`src/test/ds.test.ts` 补 `baseUrl` 与 `tools` 传参。新增一条用量记录的定向用例——`react_loop.test.ts` 的 `MockProvider` 已返回 `usage`，可直接断言累加结果。`src/test/tools/*.test.ts` 的 12 个文件与 `react_loop.test.ts` / `agent-runtime.test.ts` 的既有用例预期零改动，因为它们断言 `stopReason` / `toolCallCount` / `observations`，不依赖消息构造方式。
- **依赖**：无新增
- **破坏性**：删除 content-JSON 决策路径；任何依赖「模型输出 JSON」的调用方需同步改造（当前仅 `ds_provider.test.ts`）
