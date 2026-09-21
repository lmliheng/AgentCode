# tools.md — 工具清单与候选新增

生成日期：2026-09-22
数据来源（唯一事实依据，任何改动请回读源码）：

| 字段 | 来源 |
|---|---|
| 序列号 | `ToolRegistry.ts` 的 `createDefault` 里 `registry.register(...)` 的调用顺序 |
| 工具名 | 各类的 `readonly name` 字段 |
| 工具描述 | 各类的 `readonly description` 字段（原文照抄） |
| 首轮下发 | `config/default.ts` 的 `config.tools.eager` + `deferred.ts` 的桥工具豁免 |
| 需审批 | 各类的 `permissions.requiresApproval` |
| 输出预算 | 各类的 `outputBudget`；未声明者走全局默认兜底 |

**序列号为什么重要**：工具声明按注册顺序下发，顺序一变，模型看到的请求前缀就变（`ToolRegistry.ts`
注释原文：「无谓的调换会改变模型看到的前缀」）。所以序号不是排序建议，而是既有事实，改动需有理由。

---

## 1. 总览

| 序号 | 工具名 | 实现文件 | 首轮下发 | 需审批 | 输出预算 |
|---|---|---|---|---|---|
| 1 | `read_file` | `read_file.ts` | 是 | 否 | 10000 字符 / 300 行 |
| 2 | `apply_diff` | `apply_diff.ts` | 否（延迟） | 是 | 未声明（全局兜底） |
| 3 | `run_command` | `run_command.ts` | 是 | 是 | 30000 字符 / 500 行 |
| 4 | `fetch_url` | `fetch_url.ts` | 是 | 是 | 30000 字符 / 800 行 |
| 5 | `create_file` | `create_file.ts` | 是 | 是 | 未声明（全局兜底） |
| 6 | `git_operation` | `git_operation.ts` | 否（延迟） | 是 | 未声明（全局兜底） |
| 7 | `list_files` | `list_files.ts` | 是 | 否 | 12000 字符 / 400 行 |
| 8 | `edit_file` | `edit_file.ts` | 是 | 是 | 未声明（全局兜底） |
| 9 | `read_directory` | `read_directory.ts` | 否（延迟） | 否 | 12000 字符 / 400 行 |
| 10 | `delete_file` | `delete_file.ts` | 否（延迟） | 是 | 未声明（全局兜底） |
| 11 | `move_file` | `move_file.ts` | 否（延迟） | 是 | 未声明（全局兜底） |
| 12 | `search_code` | `search_code.ts` | 是 | 否 | 12000 字符 / 400 行 |
| 13 | `tool_search` | `tool_search.ts` | 恒常驻（桥，豁免白名单） | 否 | 未声明（全局兜底） |
| 14 | `tool_call` | `tool_call.ts` | 恒常驻（桥，豁免白名单） | 否 | 未声明（全局兜底） |

统计：注册表内 14 个工具（常驻 7 + 延迟 5 + 桥 2）；其中 6 个声明了 `outputBudget`，
8 个靠全局默认兜底。

另有两个**协议工具不在注册表、也不可执行**，只用于触发状态迁移（定义见
`src/types/AgentProvider.ts`）：`request_replan`、`batch`。它们由 Provider 负责声明与翻译，
运行时只引用名字，所以不出现在上表。

---

## 2. 当前工具详情（序号 · 工具名 · 描述原文）

### 序号 1 · `read_file`

- 实现：`read_file.ts`
- 首轮下发：是 ｜ 需审批：否 ｜ 输出预算：10000 字符 / 300 行
- 描述原文：

```text
读取文件内容。

- 修改文件前先用本工具确认当前内容，不要凭记忆构造 old_string。
- 要查某个字符串出现在哪些文件里，用 search_code，不要逐个文件读。
- path 是工作区内的相对路径；不要传绝对路径，传了会被当成相对路径拼在工作区根之后。
- 返回的 totalLines 是文件总行数；内容被截断时用 start/end 指定行区间分次读取。
- maxChars 可以调大，但整体输出预算更小，放宽后仍可能被截断成「首尾保留」的片段。
```

### 序号 2 · `apply_diff`

- 实现：`apply_diff.ts`
- 首轮下发：否（延迟） ｜ 需审批：是 ｜ 输出预算：未声明
- 描述原文：

```text
对文件应用字符串替换；与 edit_file 功能重叠，改动文件请优先用 edit_file。

- 不接受 unified diff / patch 格式的输入，参数是 old_string/new_string 纯字符串替换。
- 匹配次数不符时失败并回报实际匹配次数；调用前先用 read_file 确认待替换的内容。
- new_string 里的 $&、$1 会被当作替换模式解释；含这些片段的代码请改用 edit_file。
```

### 序号 3 · `run_command`

- 实现：`run_command.ts`
- 首轮下发：是 ｜ 需审批：是 ｜ 输出预算：30000 字符 / 500 行
- 描述原文：

```text
在工作区中执行 shell 命令，用于运行测试、编译、格式化、安装依赖等。

- 当前是 Windows，命令由 cmd.exe 执行：不支持 ; 分隔、$?、/tmp 这类 POSIX 语义，也没有 bash。& 只是顺序分隔符，不会因前一条失败而中断，用它拼接会在 exitCode 上掩盖前一条的失败。
- 命令阻塞执行，需要 stdin 交互的命令无法使用；需要长期驻留的服务类命令也不适合。
- 优先执行项目声明的脚本（如 npm test），不要自行拼装等价的底层命令。
- 返回 exitCode、stdout、stderr；判断成败看 exitCode，不要只凭输出里出现成功字样。
- 超时会杀掉整条命令进程树，已捕获的输出仍会返回；输出过长会被截断。
```

### 序号 4 · `fetch_url`

- 实现：`fetch_url.ts`
- 首轮下发：是 ｜ 需审批：是 ｜ 输出预算：30000 字符 / 800 行
- 描述原文：

```text
抓取远程 URL 的文本内容。

- 只返回文本类响应（text/json/javascript/xml/yaml）；其他类型的响应体会是 "[Binary content: ...]" 占位符，拿不到实际内容。
- 需要登录态、需要浏览器渲染、或需要 POST 的场景，本工具取不到。
- 响应体超过 512KB 会先被截断；整体输出预算更小，超长页面可能只保留首尾片段。
- 返回含 status、contentType、headers 与 body。请先看 status 判断成败，再使用 body。
```

### 序号 5 · `create_file`

- 实现：`create_file.ts`
- 首轮下发：是 ｜ 需审批：是 ｜ 输出预算：未声明
- 描述原文：

```text
在工作区中创建新文件，父目录不存在会自动创建。

- 只用于新建文件；修改已有文件用 edit_file，不要用本工具整体重写。
- content 是整文件内容：覆盖已有文件时会丢掉原有内容，先 read_file 确认。
- path 必须是工作区内的相对路径，不接受绝对路径，也不能包含 ..。
```

### 序号 6 · `git_operation`

- 实现：`git_operation.ts`
- 首轮下发：否（延迟） ｜ 需审批：是 ｜ 输出预算：未声明
- 描述原文：

```text
执行 Git 操作。各 operation 的含义：

- status：查看工作区改动。
- diff：查看尚未暂存的改动，可用 paths 限定文件。
- log：查看最近提交，limit 控制条数。只返回 7 位短 hash，拿不到完整 hash，也不支持自定义格式。
- add：暂存改动；不传 paths 等同于 git add .，会暂存工作区全部改动，请谨慎。
- commit：提交已暂存的内容。本工具不会自动 add，先确认改动已暂存。
- branch：新建分支，这不是查看分支列表。
- checkout：切换到已有分支。

只有上述 7 种操作（没有 push/pull/stash/merge）；工作区不是 Git 仓库时会直接失败。
```

### 序号 7 · `list_files`

- 实现：`list_files.ts`
- 首轮下发：是 ｜ 需审批：否 ｜ 输出预算：12000 字符 / 400 行
- 描述原文：

```text
列出工作区中的文件和目录，返回扁平列表；要看目录层级用 read_directory（不在当前工具列表里，需先经 tool_search 查询），两者不要同时调用。

- pattern 是文件名前缀匹配，不是 glob：传 "*.ts" 会一条都匹配不到，应传 "test_" 这类前缀。
- recursive 时会自动跳过 node_modules/.git/dist/.next/build/coverage。
- 返回的 total 是实际条数，truncated 表示是否被截断；返回项的 path 是相对工作区根的路径，可直接作为其他工具的 path 参数。
```

### 序号 8 · `edit_file`

- 实现：`edit_file.ts`
- 首轮下发：是 ｜ 需审批：是 ｜ 输出预算：未声明
- 描述原文：

```text
修改文件内容：把文件中的 old_string 替换为 new_string。

- 调用前必须先用 read_file 读取该文件，保证 old_string 与文件内容逐字一致（含缩进与空白）。
- old_string 要带足上下文（完整的一行或一整块）；只给 "}" 这类短片段容易匹配到别处，匹配不到或次数不符都会失败并回报实际匹配次数。
- 需要先看改动效果而不写盘时用 dryRun。
- 只做局部改动：整体重写文件用 create_file 并传 overwrite: true，移动用 move_file，删除用 delete_file。
- 参数与 apply_diff 相同，但本工具把 new_string 按字面量写入；不要在两者之间混用。
```

### 序号 9 · `read_directory`

- 实现：`read_directory.ts`
- 首轮下发：否（延迟） ｜ 需审批：否 ｜ 输出预算：12000 字符 / 400 行
- 描述原文：

```text
读取目录结构，返回树形层级信息；需要按文件名筛选或要扁平列表时用 list_files，两者不要同时调用。

- 本工具不会跳过 node_modules，且 maxItems 是全树累计计数：从工作区根展开深层目录容易被 node_modules 占满配额，建议把 path 指到具体子目录。
- 超出 maxItems 的条目不会出现在结果里。
- 返回项中的 path 是相对工作区根的路径，可直接作为其他工具的 path 参数。
```

### 序号 10 · `delete_file`

- 实现：`delete_file.ts`
- 首轮下发：否（延迟） ｜ 需审批：是 ｜ 输出预算：未声明
- 描述原文：

```text
删除文件或目录，删除后无法通过本工具恢复。

- 一次只能删一个路径，不支持通配符。
- force 会跳过人工确认直接删除，只在已经明确要删时使用。
```

### 序号 11 · `move_file`

- 实现：`move_file.ts`
- 首轮下发：否（延迟） ｜ 需审批：是 ｜ 输出预算：未声明
- 描述原文：

```text
移动或重命名文件/目录。

- source 与 destination 都必须在工作区内，不能跨工作区移动；两者相同时会被拒绝。
```

### 序号 12 · `search_code`

- 实现：`search_code.ts`
- 首轮下发：是 ｜ 需审批：否 ｜ 输出预算：12000 字符 / 400 行
- 描述原文：

```text
按行搜索工作区内的文件内容，返回匹配的文件、行号与整行内容。

- 只想读某个已知文件的内容请用 read_file，不要用本工具。
- 每行最多返回一条匹配；truncated 表示结果是否被截断。
```

### 序号 13 · `tool_search`

- 实现：`tool_search.ts`
- 首轮下发：恒常驻（桥工具，豁免白名单） ｜ 需审批：否 ｜ 输出预算：未声明
- 描述原文（源码里 `tool_call` 处是 `${TOOL_CALL}` 模板插值，此处按渲染后的文本）：

```text
检索延迟工具的声明，不改动当前的工具列表。

延迟工具的名字与一句话描述已列在系统提示的延迟工具清单里。本工具接收查询，在延迟工具集合里匹配，并把命中工具的声明（名称 + 描述 + 参数 schema）放进 <functions> 块返回。

返回的 <functions> 块只是信息。看清某个延迟工具的 schema 后，请用 tool_call 传它的确切名称与符合该 schema 的参数来调用它。不要直接调用未声明的工具：它的声明保持隐藏，模型可见的工具列表与前缀缓存才能稳定。若 select: 返回的工具已在你的工具列表里，请直接调用它——tool_call 只接受隐藏的延迟工具。

查询形式：
- "select:ToolA,ToolB" —— 按名称精确取这些工具
- "关键词短语" —— 关键词匹配，最多返回 max_results 条
```

### 序号 14 · `tool_call`

- 实现：`tool_call.ts`
- 首轮下发：恒常驻（桥工具，豁免白名单） ｜ 需审批：否 ｜ 输出预算：未声明
- 描述原文：

```text
在看过某个延迟工具的 schema 之后调用它。

- 传确切的延迟工具名与符合该 schema 的参数。
- 只接受延迟工具；已在工具列表里的工具请直接调用，不要经本工具绕一次。
- 权限与审批对被调用的工具照常生效。
```

---

## 3. 可以添加哪些工具（候选）

分类依据标注了证据来源：**「缺口证据」= 你自己源码里已写明的能力边界**；
**「同类实现」= 本机已装/已读的同类 agent 应用有该工具**；**「判断」= 我的推论，未经验证**。

### A. 有明确缺口证据的（优先）

| 候选工具 | 缺口证据 | 同类实现 | 建议 |
|---|---|---|---|
| `glob`（按通配符找文件） | `list_files.ts` 描述原文：「pattern 是文件名前缀匹配，不是 glob：传 `*.ts` 会一条都匹配不到」；`read_directory` 只给树、不按模式筛 | Qwen Code 有 `glob`；Glob 语义是同类实现的标准配置 | 进常驻（感知层） |
| `web_search`（关键词检索） | 只有 `fetch_url`，且它只支持 GET/HEAD、只认已知 URL，无法「先搜后取」 | Qwen Code 有此工具（本会话未启用，未直接验证） | 进常驻或延迟；注意需要搜索后端与配额 |
| 后台/长驻命令（如 `run_background` + 日志读取 + `kill`） | `run_command.ts` 描述原文：「需要长期驻留的服务类命令也不适合」「命令阻塞执行」 | Qwen Code 有后台执行 + `monitor` + `task_stop` | 延迟；需要进程表与输出落盘 |
| 非文本文件读取（图片/PDF/notebook） | `read_file` 用 `readFileSync(fullPath, 'utf-8')`，二进制读不出可用内容 | Qwen Code 的 `read_file` 直接支持 PNG/JPG/PDF/.ipynb | **先确认** DeepSeek 后端是否支持多模态输入，再决定做不做 |

### B. 控制流/交互类（当前注册表内完全不存在）

| 候选工具 | 缺口的证据 | 同类实现 | 注意 |
|---|---|---|---|
| `ask_user_question`（模型主动提问） | 你现在只有**审批**通道（`ToolContext.requestApproval` / `PendingAction`），没有「模型发问、用户回答」通道；`FALLBACK_PLAN_STEPS` 说明计划拿不到时只能兜底 | Qwen Code 有 `ask_user_question`；Claude Code 有 `AskUserQuestion` | 与审批模态区分开：审批是「准不准」，提问是「信息不够」 |
| `todo_write`（模型自维护任务清单） | 无 | Claude Code 有 `TodoWrite`（此前读 `sdk-tools.d.ts` 已确认）；Qwen Code 侧本会话未见同名工具 | **先评估与现有 `request_replan`/`PlanState` 的关系**——你已有运行时计划状态机，别做出两套并行状态 |
| `enter_plan_mode` / `exit_plan_mode` | 你的规划是自动触发的 `createInitialPlan`，没有「用户主动进入只读规划」这一态 | Qwen Code、Claude Code 都有 | 属于产品形态决定，不是能力缺口 |
| 子代理（`agent` / `task`） | 无 | Qwen Code 有 `agent`（含 Explore 等专职子代理） | 收益是上下文隔离；成本是递归调用与预算控制，风险最高的一项 |

### C. 结构扩展类

| 候选工具 | 依据 | 注意 |
|---|---|---|
| MCP 客户端接入（动态注册 MCP 工具 + `read_mcp_resource`） | `agent.runtime.ts:1033` 注释原文已写「新增工具（含未来 MCP 接入的工具）」；仓库里已有 `src/MCP/MCP/wxcloudMCP` | 动态注册会改动工具列表与提示前缀，需要与 `splitDeclaredTools` 的「声明集恒定」设计对齐 |
| 真正的 `apply_patch`（unified diff、多文件） | `apply_diff` 描述原文：「不接受 unified diff / patch 格式的输入」——名字暗示 patch，能力不是 patch | **不要复用 `apply_diff` 这个名字**，会加剧已有的命名误导 |
| git 扩展（`push`/`pull`/`stash`/`show`） | `git_operation` 描述原文：「只有上述 7 种操作（没有 push/pull/stash/merge）」 | 这是**有意收敛**，扩之前先想清楚：`push` 是不可逆的共享状态操作，建议单独工具 + 强制审批，不要塞进 `git_operation` 的 enum |
| `copy_file` / `make_dir` | 无 | 低价值：`create_file` 已自动建父目录 |

### D. 不建议添加

- **终止工具（`final_answer`）**：Qwen Code 与 Claude Code 都不用终止工具，终止靠「本轮没有工具调用」表达。
  加一个只会引入两套终止语义。
- **与现有工具重复的新工具**：例如再做一个 `search_files` 与 `list_files`/`search_code` 并存。
  当前 `edit_file`/`apply_diff` 已是同类问题的实例（见第 5 节）。

---

## 4. 新增一个工具要做的事

按 `src/types/Tool.ts` 的 `Tool<T>` 接口，实现这 6 个成员：

| 成员 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 全局唯一，会作为模型侧 function name |
| `description` | 是 | 直接进请求；写法上沿用现有惯例——**先说要做什么，再列出「什么时候不要用它、该用哪个」的边界** |
| `permissions` | 是 | `readsFiles` / `writesFiles` / `runsShell` / `requiresApproval` 四项布尔 |
| `outputBudget` | 否 | 建议显式声明；不声明就走全局兜底（现有 8 个工具处于这个状态） |
| `validate` | 是 | 返回 `{ valid, errors, sanitized }`；`sanitized` 负责填默认值、剔除多余字段 |
| `execute` | 是 | 签名 `execute(params, ctx)`；`ctx` 提供 `workspaceRoot` / `allowedPaths` / `requestApproval` |
| `getSchema` | 是 | JSON Schema，务必与 `validate` 的口径一致 |

注册位置：`ToolRegistry.createDefault`。两点约束：

1. **顺序即事实**：插在中间会改变提示前缀，插在末尾影响最小。
2. **通过 `config.tools.eager` 决定常驻还是延迟**：新工具建议先进延迟集合（零首轮 token 成本，
   靠 `tool_search` + `tool_call` 抵达），确认高频再提升为常驻。白名单里写了不存在的名字会在启动时直接报错。

测试参照：`src/test/runtime/deferred-tools.test.ts`（常驻/延迟切分）、
`src/test/runtime/tool-budgets.test.ts`（输出预算）、`src/test/integration/agent-runtime.test.ts`（端到端）。

---

## 5. 两个已知的待决点（仅记录，未改动）

1. **`edit_file` 与 `apply_diff` 功能重叠**：参数完全相同（`path`/`old_string`/`new_string`/`expected_count`），
   `apply_diff` 自己的描述就建议改用 `edit_file`。保留哪一个需要决断，本次未动。
2. **`glob` 能力缺失**：见第 3 节 A 组第一行。
