# Design

## Context

动机与范围见 `proposal.md`；行为契约见 `specs/`。本节只记录塑造方案的现状与约束。

当前运行时已经有一套**内部决策词汇表**（`Action` / `Replan` / `Final` / `BatchAction`），循环、重规划、批量并发、审批预览都建立在它之上。问题不在词汇表本身，而在它**没有翻译层**：Provider 既没有向模型声明工具，又试图从模型自由文本里解析出这套词汇表。

同时，三个已安装的同类实现提供了可对照的实证（本次探明，非推测）：

| | Qwen Code 0.22.3 | Claude Code 2.1.259 | Codex 0.146.0 |
|---|---|---|---|
| 内部消息形态 | Gemini `{role, parts}` | 未读取 | 未读取 |
| 工具声明 | `functionDeclarations` | `input_schema` | 未读取 |
| 并行调用 | `functionCalls` 复数，一轮全跑 | `tool_use` 复数 | 未读取 |
| 终止 | `functionCalls.length === 0` | 无 `tool_use` | 未读取 |
| Schema 兼容 | `relaxSchemaForFunctionCalling()` | — | — |
| 序列合法性 | `cleanOrphanedToolCalls()` / `ensureToolResultPairing()` | — | — |
| 控制流工具 | 无 | `EnterPlanMode` / `ExitPlanMode` / `TodoWrite` / `Task*` / `AskUserQuestion` / `Agent` | — |
| 隔离机制 | Seatbelt profile + `sandboxImageUri` 容器镜像 | — | — |

Claude Code 与 Codex 已编译为原生二进制，仅 Claude Code 的 `sdk-tools.d.ts`（由 JSON Schema 自动生成）可读，因此上表对它们的记录仅限工具清单层面，其余标注为未读取 —— 不据此断言其内部实现。

Qwen Code 的关键事实：**内部形态与外部协议分离，翻译收在边界函数**（`convertLlmToolsToOpenAI` / `convertLlmRequestToOpenAI` / `convertLlmResponseToOpenAI`，以及 `anthropicContentGenerator`）。这是本设计的直接依据。

DeepSeek 侧的硬约束（官方文档实测）：

- `tools` 格式为 `{type:'function', function:{name, description, parameters}}` —— 与现有类型定义已经一致。
- 并行 `tool_calls` **无文档说明**，示例只出现 `tool_calls[0]`。
- `strict` 模式需要 `https://api.deepseek.com/beta`，且要求所有 function 设置 `additionalProperties: false` 并把全部属性列入 `required`；现有 12 个工具的 schema 均不满足。
- 原文明确：`The Chat Completion API does not support inserting tool calls mid-conversation ... to insert tool calls, use the Anthropic API or the Responses API instead.`
- V3.2 起思考模式支持工具调用。

## Goals / Non-Goals

**Goals:**

- 让真实模型链路端到端可用：工具声明真正下发、工具调用真正被解析、历史以真实消息序列重放。
- 让「一次运行是否成功」由运行时自行判定，不依赖模型自述。
- 让审批请求真正到达交互层，而不是被硬编码默认值吞掉。
- 在改动协议的**同时**把测试影响面控制在最小：Runtime 内部决策词汇表保持稳定。

**Non-Goals:**

- 不引入上下文压缩或裁剪策略（朴素保留即可，智能预算属 Phase 1）。
- 不追求 DeepSeek `strict` 模式，也不改造现有工具的 schema。
- 不做多 Provider 适配（本 change 只把边界翻译位置划出来；OpenAI/Anthropic 适配另开 change）。
- 不加固 `run_command` 的隔离边界（属 Phase 3）。

## Decisions

### D1: 内部决策词汇表与外部协议分离，翻译置于 Provider 边界

**方案**：`ModelDecision` 继续作为运行时内部 IR，形状不变；Provider 承担双向翻译 —— 请求侧把工具集合翻译为原生工具声明，响应侧把原生工具调用翻译为 `Action` / `BatchAction` / `Final`。

**为什么**：

- 三家实证均采用「内部形态 + 边界翻译」（Qwen Code 最清晰）。这是有先例的架构，不是自创。
- **测试影响面最小**：现有 `MockProvider` 绕过真实 Provider，且其 `decide(messages, tools)` 已是双参签名；两个集成测试只断言 `stopReason` / `toolCallCount` / `observations` / `plan.version`，**不观察消息构造方式**。因此 12 个工具测试与 2 个集成测试零改动。
- Runtime 不绑定具体 Provider，后续增加适配只新增边界函数。

**替代方案与代价**：

- *让 Runtime 直接消费原生 `tool_calls`*：Runtime 将耦合具体 Provider 的消息格式，且 2 个集成测试与 MockProvider 全部需要重写。否决。
- *保留 content-JSON 路径，仅补发 `tools`*：三家均无此先例；仍承担模型格式漂移导致解析失败的风险。否决。

### D2: 终止由「本轮无工具调用」表达，不引入终止工具

**方案**：模型某一轮不调用任何工具时，Provider 将其翻译为 `Final`，循环以任务完成停止。

**为什么**：Qwen Code（`functionCalls.length === 0`）与 Claude Code（无 `tool_use`）两家一致。曾考虑引入 `final_answer` 工具，被实证推翻 —— 两家都不这么做，且终止是循环的天然出口，做成工具会额外占用一次模型轮次与一次工具调用预算。

### D3: 需要模型主动触发的状态迁移做成工具

**方案**：`Replan` 通过 `request_replan` 工具表达；批量动作用 `batch` 元工具承载。

**为什么**：

- 与 D2 直接相关：`Final` 改为「无工具调用」回落后，**模型失去了在完成轮次里携带声明的能力**，因此任何需要模型主动表达的意图都必须另开工具入口。
- Claude Code 先例充分：`ExitPlanMode` / `TodoWrite` / `AskUserQuestion` / `Task*` 全是工具。

### D4: 保留 `batch` 元工具作为并行动作的兜底

**方案**：一次 `batch` 工具调用携带动作数组；同时若 Provider 收到原生多个 `tool_calls`，也翻译为 `BatchAction`。两条来源并存。

**为什么**：DeepSeek 的并行 `tool_calls` 无官方文档保证（文档只出现 `tool_calls[0]`），而 Qwen Code 的多 `functionCall` 依赖 Gemini 协议原生支持，不可直接照搬。若只依赖原生多调用，一旦 DeepSeek 不返回多个，现有并发能力与 `maxConcurrency` 约束将失去数据来源。

**替代方案**：从 IR 中删除 `BatchAction` —— 会作废已实现的并发执行与对应测试，且未来想启用并行时需重新引入。否决。

**实测结论（任务 7.3）**：DeepSeek 单轮**确实返回多个 `tool_calls`** —— 三轮请求各返回 2 个，`finish_reason: tool_calls`，参数分别为 `{"path":"package.json"}` 与 `{"path":"tsconfig.json"}`。因此原生并行调用是可用的来源，不是未知数。`batch` 元工具保留为兜底而非唯一来源：两者并存使并行动作在任一路径下都可达，且本次实测结果不构成保留或移除它的依据。

### D5: 消息序列构造必须做合法性清理

**方案**：历史以真实 `ChatMessage[]` 维护，`assistant.tool_calls` 与 `role:'tool'` 结果共享调用标识；构造请求时清理孤儿工具调用、合并连续助手消息、保证调用与结果配对。

**为什么**：

- DeepSeek 官方明确「Chat Completion API 不支持中途插入 tool calls」，消息序列若出现无结果的工具调用即为非法。
- Qwen Code 为此专门实现 `cleanOrphanedToolCalls()` 与 `ensureToolResultPairing()`，是同一约束的已知解法。

### D6: 验收由 Runtime 独立复验

**方案**：`Final` 之后由运行时推断验证手段（优先项目测试脚本，存在类型检查配置则追加），实际执行并把结果写入结构化结论。

**为什么**：

- 客观性：模型无法用自己的叙述绕过判定。这是「地基可验证」的前提。
- **零协议改动**：不需要新增 `claim_done` 工具。若走该路线，"完成"会重新变成工具，与 D2/D3 的边界产生冲突（什么算完成、什么算声明验证）。
- 现有 `TaskVerificationResult` 的四个字段（`testResults` / `typeCheckPassed` / `diffSummary` / `completionCriteriaMet`）本就是按「运行时产出」设计的。

**替代方案**：由模型声明验证命令并执行 —— 判定质量依赖模型声明水平，且需扩协议。否决（未来若遇到推断失效的任务类型可再评估）。

### D7: 提供 `baseUrl` 默认值，不采用 `strict` 模式

**方案**：`baseUrl` 缺省为 `https://api.deepseek.com/v1/chat/completions`，`.env.example` 补充该变量；本次不启用 `strict`。

**为什么**：`strict` 需要 `beta` 端点，且要求全部 function 声明 `additionalProperties: false` 并把所有属性列入 `required`。现有 12 个工具的 schema 均不满足，改造它们超出本 change 范围，且与 D6 的验收目标无关。

### D8: 累计用量归属本 change，预算度量归属 Phase 1

**方案**：本 change 只做一件事 —— 把每轮模型返回的用量累加进运行状态，缺失时标记为未知。**「当前上下文大小」这一口径的度量、实测/估算标注、预算阈值与压缩策略**归属后续 change `context-budget`。

**为什么**：

- 两者性质不同。累计用量是**修缺陷**：Provider 已解析出用量，运行循环把它丢弃，运行状态也没有承载字段，交互层因此读取一个不存在的字段、统计恒为 0 —— 与本 change 其余五处「数据在、线没接」同类。预算度量是**新能力**，只有压缩与硬闸存在时才有价值。
- 分开后本 change 的验收标准仍保持单一（跑通一次真实任务并被客观判定），不必引入阈值配置与压缩策略。
- token 存在两类语义不同的口径：累计消耗随轮次线性增长，而每轮重发全历史使「当前上下文大小」与累计值相差数倍。若只保留一个数字又用它做预算判断，会严重误触发。本 change 只承载累计消耗，避免两个口径在此混用。

**替代方案**：把两类度量一并放入本 change —— 会把范围从「修地基」扩张到「预算治理」，且阈值必须等模型上下文窗口确认后才能定，反而推迟交付。否决。

## Risks / Trade-offs

- **[模型名可能已失效 —— 已解决]** → 实测（任务 7.3）：以 `model: "deepseek-chat"` 请求返回 200，且响应回带的 `model` 字段为 `deepseek-flash` —— 说明 `deepseek-chat` 仍是可解析的别名，指向 `deepseek-flash`。因此任务 7.1 的验收条件成立，无需为本 change 追加任务。附带结论：`deepseek-flash` 的价格页标注 `CONTEXT LENGTH: 1M`，这对后续 `context-budget` 中压缩与硬闸的紧急度判断有直接影响。
- **[DeepSeek 是否返回多个 `tool_calls` —— 已实测]** → 见 D4 的实测结论：返回，三轮各 2 个。该不确定性已消除；`batch` 元工具的保留与否不由此决定。
- **[「不支持中途插入 tool calls」是否限制历史重放 —— 已由真实运行排除]** → 任务 7.1/7.2 的真实运行中，消息序列被完整重放（7.1 共 7 次决策、含多次工具调用与结果配对；7.2 为 3 次决策），未出现服务端拒绝。D5 的配对清理已足够，不需要启用「仅重放最近一对」的降级策略。真实运行还额外暴露了一个单测覆盖不到的缺陷：Provider 的 `formatMessage` 曾把 `tool_calls` 的序列化套在 `reasoning_content` 是否存在这一判断之内，导致运行时重建的助手消息（不带 `reasoning_content`）发出时丢失工具调用，被服务端以 `content or tool_calls must be set` 拒绝。已修复并补上针对**请求体线格式**的用例。
- **[删除 content-JSON 路径后，真实链路在改造期间失去测试保护]** → 任务顺序固定为「先改造 `ds_provider` 测试使其断言原生工具调用，再改实现」，避免出现无保护的窗口期。
- **[`request_replan` / `batch` 作为工具后可能被模型滥用，绕开审批]** → `batch` 内的子动作 MUST 逐个走各自的权限判定，`batch` 本身不构成权限豁免；`request_replan` 不产生文件副作用。
- **[`MockProvider` 绕过真实 Provider，可能掩盖消息构造回归]** → 新增针对 Provider 边界翻译与消息序列合法性的定向测试，覆盖孤儿调用清理与配对。
- **[验证命令推断可能与任务类型不匹配]** → spec 已定义「不可判定」分支，明确标记而非默认通过。
- **[D1 的「零测试改动」需要限定]** → D1 的立论是「测试影响面最小」。实测结果：12 个工具测试与 `agent-runtime.test.ts` 确实**零改动**通过，协议层改动本身没有造成任何测试改动。但 `react_loop.test.ts` 的并发用例必须改一处断言 —— 它原先断言 `run()` 的墙钟上界（`elapsed < 400ms`），而真实原因是 D6 让 `run()` 结尾会执行验收命令（`npm test` 约 600ms），耗时不再只反映批量并发，该代理指标失效。已改为直接断言并发度（`maxObservedConcurrent === 2`）—— 该断言本就在同一用例中，且比墙钟更直接。此改动由 D6 引起，不由协议层引起。
- **[`src/test/ds.test.ts` 会被 vitest 误收集]** → 它是手动冒烟脚本（由 `package.json` 的 `test:ds` 经 tsx 调用），不含任何用例；被 vitest 收集会以 `No test suite found` 让整次 `npx vitest run` 报红，直接阻断本 change 的端到端验收条件。已在 `vitest.config.ts` 中排除该文件（不改名以免牵动 `package.json` 中用户已有的改动）。

## Migration Plan

本 change 为单仓库纯代码改动，无数据迁移、无 schema 变更。

执行顺序（同时缓解「改造期无测试保护」的取舍）：

0. 确认实际可用的模型名与上下文窗口（见 Risks 首条）—— 该项决定步骤 5 的验收能否成立。
1. 改造 `ds_provider.test.ts`，使其断言原生工具调用翻译（此时实现尚未改，测试应失败）。
2. 实现 D1~D5 的 Provider 边界翻译与消息序列构造，令上述测试转绿。
3. 修复接线（`baseUrl` 默认值、审批注入点），并实现 D8 的用量累计，使 CLI 路径可用且统计不再恒为 0。
4. 实现 D6 的独立复验。
5. 跑通一次真实任务作为端到端验证。

回滚策略：整体 `revert`。因无持久化状态与外部契约变更，回滚无残留影响。

## Open Questions

- ~~DeepSeek 在单轮响应中是否支持多个 `tool_calls`？~~ **已实测（任务 7.3）：支持**，三轮各返回 2 个。见 D4 的实测结论。
- 除测试脚本与类型检查外，是否还有其他应当纳入推断的验证手段（如 lint）？（可延后，新增手段不改变既有推断契约）
- 验收的测试计数依赖测试运行器的汇总行文本；若更换运行器或输出格式，需同步调整解析（退出码始终是权威结论，计数仅为补充）。`context-budget` 若引入输出截断，需确保汇总行不被截掉 —— 该能力要求「保留输出首尾」，正好覆盖此点。
