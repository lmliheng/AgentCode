# Tasks

## 1. 测试先行：让真实链路测试断言原生工具调用

- [x] 1.1 改造 `src/test/integration/ds_provider.test.ts` 的 6 个用例：删除「system prompt 要求输出 JSON」的写法，改为传入工具声明并断言「有工具调用 → 动作决策」「无工具调用 → 完成决策」。验证：此时 `npx vitest run src/test/integration/ds_provider.test.ts` 应**失败**，且失败原因是请求未携带工具声明、模型未返回工具调用（确认测试确实覆盖了待修行为）
- [x] 1.2 为边界翻译新增定向用例：多个工具调用 → 批量动作决策；调用标识在请求与结果之间透传；工具参数不可解析 → 产生失败观察而非抛错。验证：新增用例存在且各自命名对应上述三个场景

## 2. Provider 边界翻译

- [x] 2.1 补齐 `decide(messages, tools)` 签名并真实下发工具声明（名称、描述、参数 JSON Schema）。验证：`ds_provider` 中「工具声明随请求下发」用例通过
- [x] 2.2 实现响应侧翻译：1 个工具调用 → 动作决策；N 个 → 批量动作决策（顺序与响应一致）；0 个 → 完成决策（内容取自响应文本）。验证：对应三个用例通过
- [x] 2.3 删除 content-JSON 决策路径：`extractJsonFromResponse()`、`validateDecision()`，以及 system prompt 中要求模型输出 JSON 的约定。验证：全仓库检索不到这两个方法名与「按 JSON 格式回复」类提示文本，且 `ds_provider` 测试仍通过
- [x] 2.4 注册控制流工具：重新规划入口与批量动作入口。验证：工具声明列表包含二者；调用重新规划入口后 `plan.version` 递增；调用批量入口后动作被执行且每个动作有独立观察
- [x] 2.5 工具调用参数不可解析时，记录失败观察并继续循环。验证：1.2 的第三个用例通过，且循环未中断
- [x] 2.6 为 `baseUrl` 提供默认值，并在 `.env.example` 中补充该变量。验证：不传 `baseUrl` 构造 Provider 能成功发起一次真实请求

## 3. 真实消息序列

- [x] 3.1 历史改为真实 `ChatMessage[]`：助手消息携带工具调用，紧随的工具结果消息通过调用标识与之关联。验证：新增用例断言某一轮请求中工具结果与对应调用成对
- [x] 3.2 构造请求时清理孤儿工具调用、合并连续助手消息、保证调用与结果配对。验证：新增用例构造「有调用无结果」的历史，断言请求序列中不残留该调用
- [x] 3.3 从运行时记录的决策与观察重建可提交的消息序列，工具结果内容取自实际观察。验证：新增用例断言重建序列覆盖已记录的决策与观察
- [x] 3.4 回归确认：`src/test/tools/` 下 12 个文件与 `agent-runtime.test.ts` 在**未修改**的情况下通过；`react_loop.test.ts` 按批准仅改并发用例的一处断言（原墙钟上界 `elapsed < 400ms` → 直接断言并发度 `maxObservedConcurrent === 2`，因为 `run()` 结尾现在会真实执行验收命令，墙钟不再只反映并发）。验证：`npx vitest run` 全绿（19 文件 134 用例通过）；`git diff --stat` 显示该目录下仅 `ds.test.ts`、`ds_provider.test.ts`、`react_loop.test.ts` 有改动，12 个工具测试与 `agent-runtime.test.ts` 不在 diff 中

## 4. 审批链接线修复

- [x] 4.1 审批注入点归位，使待审批操作真正送达交互层；删除硬编码的批准默认值。验证：全仓库检索不到 `requestApproval` 中直接返回批准的实现；手动运行 CLI 时 `ApprovalModal` 能观察到待审批操作及其预览字段
- [x] 4.2 移除仅打印日志的占位实现，或将其接入真实审批流程；未标记需要审批的工具不得触发审批。验证：只读工具（如读文件、列目录）执行时不出现审批提示
- [x] 4.3 拒绝路径语义正确：拒绝后工具未被调用、无副作用，模型收到含拒绝原因的失败观察。验证：新增用例断言拒绝时工具未被调用且观察结果为失败

## 5. 运行状态可观测（累计用量）

- [x] 5.1 运行循环把每轮模型响应携带的 token 用量累加进运行状态；用量缺失时标记为未知，不补 0。验证：`react_loop.test.ts` 的 `MockProvider` 已返回 `usage`，新增用例断言运行状态中的累计消耗等于各轮用量之和
- [x] 5.2 修正交互层读取不存在字段导致统计恒为 0 的问题，使其展示运行状态中实际记录的用量。验证：全仓库检索不到读取不存在字段的写法；运行结束后 token 统计为真实值

## 6. Runtime 独立复验

- [x] 6.1 从工作区推断验证手段：优先项目声明的测试脚本；存在类型检查配置时追加类型检查；两者皆无时标记为不可判定。验证：新增用例覆盖「两者皆有」「仅测试脚本」「皆无」三种情形，且「皆无」不被视为通过
- [x] 6.2 实际执行验证命令并产出结构化结论：测试通过与失败数量及输出、类型检查结论、变更摘要、完成判据是否满足。验证：用例断言四个字段均有真实值，且不存在硬编码的 `false`
- [x] 6.3 验收结论不覆盖停止原因：以完成停止而验收不通过时，两者同时可读。验证：新增用例断言 `stopReason` 为完成且验收结论为不通过
- [x] 6.4 变更摘要反映实际改动而非占位内容。验证：用例断言摘要列出运行中实际变更过的文件

## 7. 端到端验证

- [x] 7.1 对 `CodingAgent` 自身仓库运行一次真实编码任务（例如修改某个工具的描述文本并跑通测试），确认循环、工具调用、验收三者串通。验证：`npx vitest run` 全绿，且本次运行的验收结论为通过（非模型自述）。该任务以「实际可用的模型名已确认」为前提，见 design.md 的 Risks 首条
- [x] 7.2 修正 `src/test/ds.test.ts`：补上 `baseUrl` 或依赖默认值，并按新签名传入工具集合。验证：执行该脚本输出中包含一次成功的工具调用观察
- [x] 7.3 实测 DeepSeek 单轮响应是否返回多个工具调用，并记录结论（不影响批量入口的兜底地位）。验证：结论写入本 change 或代码注释，明确记录实测结果

## 7 的实测记录（2026-09-20）

对仓库的一次性副本（`.qwen/tmp/ws-7-1`，与原仓库同代码、node_modules 目录联接复用）运行，以免自动放行的模型改动尚未提交的工作树：

- **7.1**：任务「在 `src/tools/read_file.ts` 的 description 末尾追加一句说明」。结果 `stopReason = task_completed`，7 次决策 / 8 次工具调用 / 成功观察 7，累计用量 49790 tokens（`complete: true`），文件变更记录 `apply_diff → src/tools/read_file.ts`，验收 `passed = true`、`verificationStatus = executed`、`testResults = 86 passed / 0 failed`、`completionCriteriaMet = true`、`typeCheckPassed = null`（副本无本地 typescript，如实记为未执行）。仓库侧 `npx vitest run` 19 文件 135 用例全绿。
- **7.2**：`npx tsx --env-file=.env src/test/ds.test.ts .qwen/tmp/ws-7-1`。`stopReason = task_completed`，成功观察 5/5，首个成功观察为 `read_directory` 的真实数据；脚本未传 `baseUrl`，默认端点生效。同一结论：验收 `passed = true`、86 passed。
- **7.3**：裸请求直读原始响应（绕开翻译层），三轮一致返回**2 个 `tool_calls`**、`finish_reason = tool_calls`。附带结论：响应回带的 `model` 为 `deepseek-flash`，即 `deepseek-chat` 仍可解析为别名。

真实运行还暴露并已修复两个单测覆盖不到的缺陷：Provider 的 `formatMessage` 丢失 `tool_calls`（服务端以 `content or tool_calls must be set` 拒绝）；`parseTestCounts` 未剥离 ANSI 转义导致计数恒为 0。两者均已补上对应用例（请求体线格式、带 ANSI 的汇总行）。
