# Design

## Context

动机与范围见 `proposal.md`；行为契约见 `specs/`。本节只记录塑造方案的现状与实证。

### 现状：三种口径混用，两个失控项

| 工具 | 现有上限 | 折算约 | 问题 |
|---|---|---|---|
| `read_file` | `maxChars` 8000 + 200 行 | ~2K token | 双重上限，口径正确 |
| `search_code` | `maxResults` 50 条 | ~2K token | 条目数口径 |
| `list_files` | `maxResults` 200 条 | ~4K token | 条目数口径 |
| `read_directory` | `maxDepth` 1 | 不定 | 无条数/字符上限 |
| `fetch_url` | `MAX_BODY_SIZE` 512KB | **~128K token** | 口径错位 |
| `run_command` | 无 | 不定 | 完全失控 |

`fetch_url` 的 512KB 对 HTTP 防护是合理的，对上下文预算差约 60 倍。`run_command` 连上限都没有。

### 实证：Qwen Code 的截断实现

`truncateToolOutput(config, toolName, content, limits, promptId)`：

```js
const threshold = limits?.threshold ?? config.getTruncateToolOutputThreshold();  // 字符上限
const lines     = limits?.lines     ?? config.getTruncateToolOutputLines();      // 行数上限
const keep      = limits?.keep      ?? "both";                                   // 默认保两端
if (threshold <= 0 || lines <= 0) return { content };                            // 可关闭
```

四条可直接引用的理由，均来自其源码注释：

```
// lines: Infinity keeps this char-only so the global line cap can't undercut
// the effective Shell char budget — many short lines (e.g. `find /`, `ls -R`)
// would otherwise truncate while chars remain.
```
→ 只限字符会被「很多短行」绕过。

```
// keep='both' preserves the command's start AND its trailing exit/error summary
// (where shell failures report).
```
→ 命令失败摘要在尾部，只保头部会切掉最关键信息。

```
// Kept in-tool (not deferred to the scheduler) so the long-run hint below is
// appended OUTSIDE the truncation envelope; the scheduler's sentinel makes its
// later pass a no-op here.
```
→ 工具内截断 + 运行时兜底**两级并存**，且幂等。

```js
const fileName = `${toolName}_${crypto.randomBytes(6).toString("hex")}`;
await truncateAndSaveToFile(content, fileName, config.storage.getProjectTempDir(), ...)
```
→ 完整输出落盘，只把「截断内容 + 路径」送入模型；另有 `isAlreadyTruncated()` 靠标记前缀保证幂等。

### 窗口规模尚未确认

DeepSeek 价格页对 `deepseek-flash` 标注 `CONTEXT LENGTH: 1M`、`MAX OUTPUT: 384K`；`/models` 文档示例同样只列 `deepseek-flash` 与 `deepseek-v4-pro`。代码在 7 处硬编码 `deepseek-chat`，该名称已不在文档中出现，是否仍作为遗留别名可用待确认（另见 `runtime-foundation` 的 Risks 首条）。

**这不阻塞本设计的方向**：无论窗口是 1M 还是更小，`fetch_url` 返回 512KB 都是错的 —— 区别只在紧急度（浪费成本 vs 直接溢出）。它影响的是**阈值取值**，因此阈值设计为可配置。

## Goals / Non-Goals

**Goals:**

- 让「进入模型的内容体积」有一个统一、可预期、可配置的口径，替换三种混用口径。
- 让被截断的信息可恢复：截断不丢数据，只把全文挪到外部。
- 让「当前上下文有多大」可读，为后续压缩与限流提供判据。
- 让未声明预算的工具（含未来新增的、MCP 接入的）自动获得兜底。

**Non-Goals:**

- 不裁剪、不摘要、不丢弃历史（T4 压缩另开 change）。
- 不因度量超阈值改变循环行为（T5 硬闸另开 change）。
- 不设计落盘的清理与生命周期管理（本 change 只定位置与命名约定）。
- 不把工具输出落盘当作「记忆」的一部分；它只是溢出区。

## Decisions

### D1: 采用字符 + 行数双重上限

**方案**：两个维度同时约束，任一超出即截断；上限可显式关闭。

**为什么**：只限字符会被「行数极多但每行很短」的输出绕过 —— Qwen Code 明确以此为由引入行数上限，并举 `find /`、`ls -R` 为反例。本项目 `list_files` 已有 `maxResults` 说明作者意识到「条目多」是个独立风险，只是没统一到字符维度上。

**替代方案**：统一为单一字符上限 —— 实现更简单，但对「大量短行」类输出失效。否决。

**细节**：工具级设置可覆盖全局，且当工具只想按字符约束时可显式把行数上限设为无限，避免全局行数上限削掉工具自身的字符预算（这是 Qwen Code 对 Shell 的处理方式）。

### D2: 截断保留首尾两端

**方案**：保留输出的开头与结尾，并在中间标出省略位置。

**为什么**：命令执行的失败摘要位于尾部。本项目 `run_command` 正是「尾部含关键信息」的典型（`npm test` 的失败摘要在末尾），只保头部会使截断后的输出失去诊断价值 —— 比不截断更糟。

**替代方案**：保头部（简单）或保尾部（丢上下文）—— 两者都会丢掉一半有用信息。否决。

### D3: 完整输出外部化到工作区之外的临时目录

**方案**：截断发生时把完整输出写入工作区外的临时目录（按项目区分），并把路径随截断内容一并提供。

**为什么**：

- 截断的目的是控制进入模型的内容，而非丢弃数据。保留全文使模型可 `read_file` 取回细节，避免「因为截断而看不清」。
- 放在**工作区之外**是因为工作区内可能被 `git_operation` 暂存、被 `read_directory` 列出、被 `search_code` 搜到 —— 大量临时文件会污染这些工具的结果，也会污染用户的版本库。
- Qwen Code 同样写入 `storage.getProjectTempDir()`（项目临时目录），而非工作区。

**替代方案**：直接丢弃超限内容 —— 会制造「信息静默丢失」这一新缺陷。否决。

### D4: 截断必须幂等

**方案**：送入模型的内容带可识别的截断标记；已带标记的内容在后续截断处理中被跳过。

**为什么**：两级兜底（D5）意味着同一段内容可能经过两次截断处理。若幂等缺失，会出现嵌套截断、重复省略标记，以及「完整输出路径指向一个已被截断的文件」这类不一致。Qwen Code 用 `isAlreadyTruncated()` 检测标记前缀解决同一问题。

### D5: 两级兜底，而非二选一

**方案**：工具内可截断（按自身语义决定保什么），运行时层统一兜底；工具未声明预算时用全局默认。

**为什么**：

- 只做「工具内截断」会漏 —— `run_command` 就是当下漏掉的那个；且未来新增工具（含 MCP 接入的工具）默认无预算。
- 只做「运行时统一截断」会丢失语义 —— 运行时不知道该工具的哪段输出更重要，`run_command` 的尾部失败摘要正是只有工具层才知道的事。
- Qwen Code 的答案是两者并存（工具内截断 + 调度器 sentinel 兜底），并让工具级预算覆盖全局。

**替代方案**：集中到运行时一处 —— 实现最简，但无法表达「命令失败摘要在尾部」这类工具专属语义，只能统一保头尾，对结构化输出（如 JSON）效果更差。否决。

### D6: 当前上下文大小取最近一轮输入量，两类口径分开存放

**方案**：新增「当前上下文大小」度量，取最近一轮请求实际消耗的输入 token 数；与「累计消耗」分别存放、分别可读；每项度量标注实测/估算。

**为什么**：

- 每轮都重发完整历史，因此「当前上下文大小」就是最近一轮的输入量；而「累计消耗」是各轮之和。二者相差数倍，若只保留一个数字又用它做预算判断，会严重误判（用累计值判断会提前数百倍触发）。
- **不需要引入 tokenizer**：Provider 已经返回真实用量（`ModelResponse.usage`）。用上一轮的真实输入量作为当前大小的代理，既准确又免依赖。
- 标注实测/估算是因为二者可信度不同，混同会让后续阈值判断失去依据（Qwen Code 有 `IsEstimated` 标记，出于同一考虑）。

**替代方案**：自建 tokenizer 精确计算当前消息序列长度 —— 需引入依赖且与实际计费口径未必一致，而 provider 已给出真实值。否决。

### D7: 度量与行为解耦，本 change 不触发压缩

**方案**：本 change 只产出度量与判据，不因超阈值而压缩、裁剪或停止。

**为什么**：阈值取值缺乏实测依据（窗口规模待确认，且实际每轮的输入增长分布未知）。若在同一 change 里既定义阈值又让它生效，一旦阈值不合适，问题会表现为任务质量下降而非报错，难以定位。分开后可以先只观测、拿到真实分布，再决定阈值与压缩策略。

**替代方案**：一并实现滑动窗口裁剪 —— 交付更快，但把「未验证的阈值」直接接入行为，风险与调试成本都高。否决。

## Risks / Trade-offs

- **[阈值取值缺乏实测依据]** → 只提供保守默认值并保持可配置；先以「只观测」的方式运行，拿到真实分布后再定。默认值取值：全局 8000 字符（沿用 `read_file` 的既有口径，保证不引入新的量级），`run_command` 30000 字符且限 500 行（命令输出行多但关键信息集中）。这些默认值属可调整项，不写入 spec。
- **[落盘文件长期积累]** → 本 change 只定义位置与命名约定（含工具名与随机后缀），不定义清理。若长期运行导致积累，清理策略作为后续变更引入；位置选在工作区外也使其不影响版本库。
- **[截断改变工具输出结构]** → 工具结果新增「是否被截断」与「全文位置」信息，读取工具结果的调用方需适配。`runtime-foundation` 提及的 12 个工具测试直接断言 `validate` / `execute` 的返回值，会受影响，需同步更新。
- **[`fetch_url` 上限收紧是破坏性变更]** → 单次抓取返回的正文显著变小。缓解：全文已落盘可读取；错误信息在尾部也因 D2 被保留。需要完整正文的场景应先落盘再分段读取。
- **[与 `runtime-foundation` 修改同一段代码]** → 两者都触及 `agent.runtime.ts` 与工具结果处理。缓解：明确先后顺序（先 `runtime-foundation` 后本 change），不并行开发。
- **[全局行数上限可能削掉工具自身的字符预算]** → 按 D1 细节，允许工具显式把行数上限设为无限。需在实现中确保工具级设置优先于全局。

## Migration Plan

本 change 为单仓库纯代码改动，无数据迁移、无 schema 变更。**前置条件**：`runtime-foundation` 已应用（消息装配接缝与运行状态字段就位）。

执行顺序：

1. 在工具类型上引入可选的输出预算声明，并为运行时兜底层实现统一的截断语义（字符 + 行数、保首尾、外部化、幂等）。
2. 逐个校准工具的预算声明：`read_file` / `search_code` / `list_files` / `read_directory` 沿用或补齐；`fetch_url` 从 512KB 收到预算口径；`run_command` 补上上限。
3. 实现运行时的兜底应用，确保未声明预算的工具也受约束。
4. 实现两类 token 度量的记录与来源标注。
5. 同步更新受影响的对象：12 个工具测试中涉及输出结构的断言。

回滚策略：整体 `revert`。落盘产生的临时文件位于工作区外，回滚不影响仓库状态。

## Open Questions

- 具体的阈值取值（全局字符上限、`run_command` 的字符与行数上限）应在拿到真实任务的实际输出分布后再校准；本 change 先以保守默认值交付。
- 落盘文件的清理策略（按数量、按时间、按大小）可延后引入，不改变本 change 的位置与命名约定。
