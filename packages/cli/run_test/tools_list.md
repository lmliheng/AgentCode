# CodingAgent 工具清单与 Qwen Code 工具集对照

生成日期：2026-09-22
来源（唯一事实依据，改动请回读源码）：

- 工具注册：`src/CodingAgent/src/tools/ToolRegistry.ts`（`createDefault`）
- 常驻白名单：`src/CodingAgent/src/config/default.ts`（`config.tools.eager`）
- 常驻/延迟判定：`src/CodingAgent/src/tools/deferred.ts`
- 各工具定义：`src/CodingAgent/src/tools/*.ts`（工具名取自各类的 `name` 字段）

对照对象是 **Qwen Code 本会话可见的工具集**。这一列会随会话、设置与延迟工具加载状态变化，
不是稳定契约；下表的「Qwen Code」列仅描述本次核对时的实况。

---

## 1. 你的工具清单（共 14 项）

### 1.1 常驻工具（7 项，schema 随首轮请求下发）

| 工具名 | 实现文件 | 作用 | 需审批 |
|---|---|---|---|
| `read_file` | `read_file.ts` | 按行区间读文件，带 `totalLines` 与截断标记 | 否 |
| `search_code` | `search_code.ts` | 按正则逐行搜工作区，返回文件/行号/整行；支持 `include`/`exclude`/上下文行 | 否 |
| `list_files` | `list_files.ts` | 扁平列出文件/目录，递归时跳过 `node_modules`/`.git`/`dist` 等 | 否 |
| `edit_file` | `edit_file.ts` | `old_string` → `new_string` 字面量替换，支持 `dryRun`、`expected_count` | 是 |
| `create_file` | `create_file.ts` | 新建文件，父目录自动创建；`overwrite` 默认 `false`（已存在即失败） | 是 |
| `run_command` | `run_command.ts` | 执行 shell 命令（cmd.exe），超时杀进程树；返回 `exitCode`/`stdout`/`stderr` | 是 |
| `fetch_url` | `fetch_url.ts` | 抓取 URL 文本内容（仅 GET/HEAD，仅文本类响应，512KB 截断） | 是 |

### 1.2 延迟工具（5 项，已注册可执行，schema 不进请求，经 `tool_search` + `tool_call` 抵达）

| 工具名 | 实现文件 | 作用 | 需审批 |
|---|---|---|---|
| `apply_diff` | `apply_diff.ts` | 同参数替换，但 `new_string` 里 `$&`/`$1` 会被当替换模式解释 | 是 |
| `delete_file` | `delete_file.ts` | 删除文件或目录，`force` 可跳过确认 | 是 |
| `move_file` | `move_file.ts` | 移动/重命名，`overwrite` 默认 `false` | 是 |
| `read_directory` | `read_directory.ts` | 读目录树（含 `children`）；**不跳 `node_modules`**，`maxItems` 全树累计 | 否 |
| `git_operation` | `git_operation.ts` | 限定 7 种操作：`status`/`diff`/`log`/`add`/`commit`/`branch`/`checkout`（无 push/pull/stash/merge） | 是 |

### 1.3 桥工具（2 项，豁免白名单，恒常驻）

| 工具名 | 实现文件 | 作用 | 需审批 |
|---|---|---|---|
| `tool_search` | `tool_search.ts` | 检索延迟工具声明（`select:A,B` 或关键词），只回传 schema 文本，不改动工具列表 | 否 |
| `tool_call` | `tool_call.ts` | 调用延迟工具；自身不执行，必须由 `AgentRuntime` 派发以保留目标工具的校验/审批/预算 | 否 |

---

## 2. 与 Qwen Code 工具的重复对照

| Qwen Code 工具 | 你的对应工具 | 重复度 |
|---|---|---|
| `read_file` | `read_file` | **完全重复**，同名同职责 |
| `run_shell_command` | `run_command` | **完全重复**，只差命名 |
| `grep_search` | `search_code` | **完全重复**（你用 `readdirSync` + `RegExp` 逐行扫，Qwen Code 用 ripgrep；语义等价） |
| `glob` | `list_files` | **重叠但不等价**，见 3.1 |
| `web_fetch` | `fetch_url` | **重复**；你的多了 `headers`/`timeout` 与 `status`/`headers` 返回，Qwen Code 的抓取后交模型处理 |
| `web_search` | 无 | **你没有**，见 3.4 |
| `edit` | `edit_file` + `apply_diff` | **重复，且你内部也重复**，见 3.2 |
| `write_file` | `create_file` | **重复**，语义有差，见 3.3 |
| `tool_search` | `tool_search` | **重复**（`deferred.ts` 注释已声明语义对齐 Qwen Code 的 `tools.eager`；连「只回传 schema、不改列表」的行为也一致） |
| `tool_call` | `tool_call` | **重复**（同上；两者都靠运行时派发，工具自身不执行目标工具） |
| `skill` | 无 | **你没有**（Qwen Code 侧独有的能力层） |

### 只有你有、Qwen Code 没有专用工具的

| 你的工具 | Qwen Code 侧的做法 |
|---|---|
| `delete_file` | 走 `run_shell_command` |
| `move_file` | 走 `run_shell_command` |
| `git_operation` | 走 `run_shell_command` |

这三项不算重复：Qwen Code 没有把它们收敛成专用工具，安全护栏更弱（换成你的工具则有 `overwrite` 默认拒绝、
操作类型白名单等约束）。

### Qwen Code 有、你没有的（本次核对时可见）

`agent`、`ask_user_question`、`artifact`、`notebook_edit`、`display_image`、plan 模式系列
（`enter_plan_mode`/`exit_plan_mode`）、goal 系列（`get_goal`/`propose_goal`/`update_goal`）、
`cron_*`、`loop_wakeup`、`monitor`、`send_message`、`list_agents`、`task_stop`、
`enter_worktree`/`exit_worktree`、`read_mcp_resource`、`record_artifact`、`report_findings`、`zoom_image`。

---

## 3. 需要决断的四个点

### 3.1 `glob` 语义在你的工具集里没有对等物

`list_files` 的 `pattern` 是**文件名前缀匹配**，不是 glob —— 传 `*.ts` 一条都匹配不到。
`read_directory` 给的是树形结构而非按模式筛选。于是「按扩展名/通配符找一批文件」这个高频场景
在你的 14 个工具里没有真正覆盖。若要补，最小改动是把 `list_files.pattern` 换成真正的 glob 匹配。

### 3.2 `edit_file` / `apply_diff` 是内部冗余，不是跨体系冗余

两者参数完全相同（`path`/`old_string`/`new_string`/`expected_count`），`apply_diff` 的 description
自己写着「与 edit_file 功能重叠，改动文件请优先用 edit_file」。唯一实质差异是 `apply_diff` 的
`new_string` 中 `$&`/`$1` 会被当作替换模式解释 —— 这正是它建议避开自己的理由。
保留一个即可；保留 `edit_file` 更省一次「别用另一个」的提示成本。

### 3.3 `create_file` vs `write_file`：差别是护栏，不是命名

Qwen Code 的 `write_file` 直接覆盖写；你的 `create_file` 默认 `overwrite: false`，已存在即失败，
「修改已有文件」被明确让给 `edit_file`。合并两者时**不要丢掉这个默认拒绝**。

### 3.4 `fetch_url` 不能替代 `web_search`

抓取已知 URL ≠ 搜索。另外 `fetch_url` 只支持 GET/HEAD、只取文本类响应、需登录态的页面取不到，
这些限制已写进它的 description，属于设计取舍而非缺陷；只是别把它当成搜索能力的替代品。

---

## 4. 上一版内容更正

本文件上一版记的是「`src/tools/run_command.ts` 导出函数列表」，结论是「共 0 个导出函数」，
并称该文件唯一的导出成员是类 `RunCommandTool`。

该结论对「导出函数」这一统计口径成立，但作为工具清单是误导的：工具名由类的 `name` 字段声明，
与是否导出函数无关。`run_command.ts` 实际注册的工具名是 **`run_command`**，
其余 13 个工具的注册名见第 1 节。

---

## 5. 核对用的检索模式

以下为搜索模式（在仓库根目录 `AgentCode/` 下检索；`grep` 在 Windows 的 cmd.exe 里未必可用，
用 ripgrep 或 IDE 搜索即可）：

| 目标 | 模式 | 范围 |
|---|---|---|
| 工具注册顺序 | `new \w+Tool\(` | `src/CodingAgent/src/tools/ToolRegistry.ts` |
| 各工具声明的 name | `^\s*(readonly\s+)?name\s*=` | `src/CodingAgent/src/tools/` |
| 常驻白名单实况 | `eager` | `src/CodingAgent/src/config/default.ts` |
