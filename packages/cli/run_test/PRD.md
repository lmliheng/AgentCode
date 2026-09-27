# CodingAgent 改进 PRD

> 依据：2026-09-21 全量任务测试（`run_test/9.21.task.md` 10 个任务 + `9.21_1.md`~`9.21_8.md` 8 份完整运行 trace，含手写批注）。
> 本文所有结论都在源码里核对过，并另跑了两次实测探针验证（探针脚本已删除）。行号为 2026-09-21 当日代码。

## 0. 结论先行

8 次运行：6 次跑完、2 次失败（任务 8 天气 60s 超时未产出、任务 9 类型检查未产出）；跑完的 6 次里又有 1 次产物内容错误（`tools_list.md` 自相矛盾）。真正的问题不是「工具不够」，而是四类系统性问题：

| 类别 | 一句话 | 优先级 |
|---|---|---|
| 成本 | 每轮为「重讲 12 个工具声明」固定花掉约 4–5k tokens，历史观察全量重发，累计消耗随轮数近平方增长 | P1 |
| 安全边界 | `search_code` 带 `path` 必失败、`read_file` 无工作区边界可越权读；审批有 UI 但无审计、headless 默认放行 | P0 |
| 回退与循环 | 防循环守卫对 `BatchAction` 完全失效；自动 replan 只「停下来报错」不真的重规划；计划状态机永不推进 | P0 |
| 验收可信度 | 验收跑的是仓库自带 169 个单测，与任务交付物无关，导致「什么都没产出」也报 `passed: true` | P0 |

原始记录的 4 个待办（Prompt Token 开销 / 执行审批 / 任务测试 / 决策回退）全部保留在第 2、3、7 节，并已补上证据与验收标准。

---

## 1. 证据基线

### 1.1 任务结果与成本（trace 原始数字）

| trace | 任务 | 轮数 | 工具调用 | promptTokens（累计） | completion | 末轮上下文 | 结果 |
|---|---|---|---|---|---|---|---|
| `9.21_1.md` | 查工作区绝对路径 | 4 | 3 | 24,741 | 713 | 5,473 | 完成；首条命令报错乱码，改 `cd` 兜底 |
| `9.21_2.md` | 任务1 找导出函数 | 9 | 8 | 81,479 | 1,563 | 10,787 | 产出但内容错误 |
| `9.21_3.md` | 任务4 git log | 4 | 3 | 24,587 | 926 | 5,251 | 完成 |
| `9.21_4.md` | 任务5 文件大小排序 | 6 | 6 | 40,957 | 1,431 | 6,938 | 完成（先踩 POSIX 命令，改 Node 兜底） |
| `9.21_5.md` | 任务6 httpbin | 4 | 3 | 24,910 | 535 | 5,291 | 完成 |
| `9.21_6.md` | 任务7 建/移/删文件 | 4 | 5 | 25,782 | 713 | 5,827 | 完成（2 次无用 `list_files`） |
| `9.21_7.md` | 任务8 天气 | 14 | 28 | **340,634** | 4,349 | 34,605 | **失败**：60s 超时，`weather.md` 未产出 |
| `9.21_8.md` | 任务9 tsc + test:ds | 5 | 7 | 35,237 | 1,093 | 6,777 | **失败**：`typecheck.md` 未产出 |

`9.21.task.md` 共 10 个任务，其中任务 2（改 `src/index.ts`）引用的文件已被删除（`git status` 显示 `D src/index.ts`），任务 3、10 没有对应 trace —— 任务集本身需要维护。

### 1.2 每轮固定开销实测

用 `npx tsx` 直接导入 `baseTools()` 量得：

```
工具数量: 12
工具声明 JSON 总字符数: 8885      // 不含 request_replan / batch 两个控制流工具
单工具最大: search_code 1102 / git_operation 991 / edit_file 949
```

按本机实测的字符/token 比（中文 1.72、混合语料 2.4），8,885 字符 ≈ **3,700–5,200 tokens，每一轮都要重发**。交叉验证：`9.21_3.md` 那一轮完整上下文是 5,251 tokens，而当轮全部工具输出合计只有 560 字符 —— 也就是**最小上下文里有约 90% 是工具声明，不是任务内容**。系统提示词本身只有约 350 字符，不是大头。

---

## 2. P1 · Prompt Token 开销（原始待办 1）

**现象。** `9.21_2.md` 顶部批注：「为什么 token 消耗能到几万，哪里消耗这么大，readfile 的全量阅读？」

**先纠正一个前提：`read_file` 不是全量阅读。** `read_file.ts:85-90` 默认只返回第 1 行起最多 200 行、且不超过 `maxChars`(8000)；`9.21_2.md` 里 248 行的文件是被读了两段（1–200 + 200–248）才拼出全貌的。

**根因（按贡献排序）。**

1. **工具声明是固定大头**：12 个工具约 3.7–5.2k tokens/轮（见 1.2），与控制流工具一起每轮必发。 
2. **历史全量重发**：`agent.runtime.ts:905` 的 `buildContextMessages()` 每轮把 system + plan + 全部 decisions + 全部 observations 重新拼一遍发给模型，没有任何裁剪。累计 `promptTokens` 因此近似平方增长：`9.21_7.md` 14 轮累计 340,634，末轮单轮 34,605。
3. **单条观察体积大**：`9.21_7.md` 的 `read_directory` 一条结果 123,264 字符、`wttr.in?format=j1` 单行 JSON 47,986 字符、`dir /s /b` 11,829 字符 —— 三者约占该 trace 的 84%。
4. **无用调用也被永久保留**：`9.21_4.md` 里 `list_files` 与 `read_directory` 返回了同一批 13 个文件（约 2.8KB 重复）；`9.21_2.md` 一次全仓模糊搜索返回 50 条命中、6,257 字符，对答案零贡献。
5. **缓存信息被丢弃**：DeepSeek 返回 `prompt_tokens_details.cached_tokens / prompt_cache_hit_tokens`，但 `deepseek.provider.ts:187-190` 只取 3 个数字，`agent.runtime.ts:256` 只累加 —— 无法回答「这些 token 里有多少是缓存命中」。

**建议。**
- 工具声明瘦身：`description` 目标压到 ≤150 字符（当前 12 个平均 264、`edit_file` 458）；或按任务阶段分组下发（读阶段只发读工具）。
- 上下文治理：观察保留最近 N 条 + 更早的折叠成摘要；同一工具的重复成功结果只留最后一条。
- 调用 DeepSeek 前缀缓存：稳定内容（system + 工具声明）固定在前，动态内容在后；并把 cached tokens 透传进 `tokenUsage`。
- 展示口径：`tokenUsage`（累计成本）与 `contextSize`（当前上下文）已经分开，UI 应同时展示，避免把累计值误读成单次开销。

**验收标准。** 同一批 10 个任务重跑：`9.21_3.md` 这类「3 次工具调用」的任务，累计 `promptTokens` 从 24,587 降到 12,000 以下；`9.21_2.md` 的 81,479 降到 35,000 以下；且 6 个已完成任务的产物内容不变。
---





## 3. P1 · 执行审批（原始待办 2）
**现状（已实现的部分）。** TUI 侧确实接通了：`cli/composable/useAgent.ts:87` 把待审批动作交给 UI，`cli/components/ApprovalModal.vue` 阻塞等按键；运行时侧 `permissions.requiresApproval` 的工具（`run_command`、`apply_diff`、`delete_file`、`move_file`、`git_operation` 写操作、`fetch_url`）会走 `requestApproval`。
**问题。**


1. **无审批审计。** `AgentRunState`（`agent.runtime.ts:212` 的 `initializeState`）没有审批字段，8 份 trace 里查不到「谁批准了什么」；审批只留了一行 `console.warn`。这是「执行审批怎么做」最先要补的：**审批决定必须进 state 与 trace**。
2. **headless 默认放行。** `agent.runtime.ts:662`：未配置 `requestApproval` 时 `approvalPolicy` 默认 `'auto-approve'`，只告警一次。CI / 脚本调用会在无人确认的情况下执行破坏性命令。默认值应改为 `'auto-reject'`（或至少要求显式声明）。
3. **没有「记住/白名单」。** 每个动作都弹一次，长任务会被打断 N 次；`approvalCache` 只在单个动作内去重（`agent.runtime.ts:540`）。需要会话级「本会话允许此类命令」与规则化 allowlist（如 `npm test`、`git status` 免问，`rm -rf`/`git push --force` 必问）。
4. **风险分级粗糙、黑名单既弱又误伤。** `run_command` 一律 `riskLevel: 'medium'`；`run_command.ts:63-70` 的危险命令检测是 6 条 `includes` 字符串（`rm -rf /`、`sudo`、`shutdown`、`reboot`、`mkfs`、`dd if=`）——既拦不住 `del /s /q`、`Remove-Item -Recurse -Force`，又会误伤 `echo 'sudo'` 这类只是提到关键字的命令。
5. **无人应答会永久阻塞。** `PendingAction.expiresAt`（5 分钟）被 6 处写入，但全仓库**没有任何地方读取它**；UI 若卡住，运行就永远挂起。
6. **审批与执行的时序风险。** `run_command` 内部又向 `ctx.requestApproval` 问一次（`run_command.ts:99`），虽然被 `approveOnce` 去重，但「运行时问一次、工具再问一次」的双份实现容易分叉，应把审批收敛成工具声明 + 运行时统一执行。


**验收标准。** (a) 任一次运行结束后，state 里能列出每个待审批动作的 preview、决定、时间、来源；(b) 不传 `requestApproval` 时破坏性命令被拒绝而非放行，并有明确 stop reason；(c) 审批等待超时后按拒绝处理并继续/终止运行，不挂起；(d) 新增覆盖以上四点的测试。

---

## 4. P0 · 安全边界与路径一致性

### 4.1 `search_code` 只要带 `path` 就必然失败（实测复现）

`search_code.ts:118-119`：
```ts
const resolved = join(searchPath);
const allowed = ctx.allowedPaths.some(p => resolved.startsWith(p));   // 缺 resolve(p)
```

另外 7 个文件工具（`create_file.ts:89`、`delete_file.ts:81`、`apply_diff.ts:88`、`list_files.ts:105`、`move_file.ts:84-85`、`read_directory.ts:95`）都写的是 `resolve(p)`，只有这里漏了；而且运行时传进来的 `allowedPaths` 就是 `this.config.workspacePath`（`agent.runtime.ts:543`），默认值 `'.'` 是**相对路径**。


实测（`workspaceRoot='.'`、`allowedPaths=['.']`）：
```
[A]  search_code path=src/tools      => false  路径 src/tools 不在允许的工作区内
[A2] search_code 不带 path           => true
[B]  search_code path=src/tools（workspace 为绝对路径） => true
```
与 `9.21_2.md` 观察到的完全一致：同一次运行里 `read_file` 用**同样的相对路径**成功，`search_code` 带着路径连续失败两次，模型被迫退化成全仓 50 条命中的模糊搜索，白烧两次调用 + 6KB 上下文。这是一行修复（`resolve(p)`）+ 一个回归测试；同时 `join()` 也应换成 `resolve()`。


### 4.2 `read_file` 完全不检查工作区边界

实测：`read_file('../../package.json')` **成功读回 62 行**。`read_file.ts` 里没有 `allowedPaths` 相关代码（`read_file.ts:76` 直接 `resolve(ctx.workspaceRoot, params.path)`）。所有其它文件工具都有检查，唯独最常用的读工具没有 —— 这既是越权读取，也是「同一套边界规则各写一遍」的必然结果。

### 4.3 `startsWith` 判定本身不严

8 处检查都是 `path.startsWith(resolve(workspaceRoot))` 的字符串前缀比较，未做 `normalize`/`realpath`：工作区为 `C:\ws` 时 `C:\ws-evil\x` 会被判为合法，`..` 也未统一处理，符号链接可绕过。

**建议。** 抽一个 `fs-guard`（`resolve` + `realpath` + `path.relative` 判定，拒绝 `..` 逃逸）作为所有文件工具的唯一入口 —— 这正是代码里预留的 TODO（`agent.runtime.ts:543` 注释写着「后续由 fs-guard 管理」），逐个替换现有 8 处手写检查，并补上「工作区外路径被拒」的参数化测试（含 `search_code` 带 path、`read_file` 越权两个用例）。

**验收标准。** 上述两个实测探针必须以「拒绝」收场；新增测试覆盖 `..` 逃逸、前缀碰撞、符号链接三种情形。

---

## 5. P0 · Windows / cmd 环境适配

1. **输出乱码（4 份 trace 均出现）。** `run_command.ts:189-190` 用 `data.toString()`（默认 UTF-8）解码 cmd.exe 的 GBK 输出，于是 `'ls' 不是内部或外部命令` 变成 `'ls' �����ڲ����ⲿ���Ҳ���Ǵ����еĳ���`，模型读不到真实原因。同类乱码出现在 `9.21_1.md`(`pwd`)、`9.21_4.md`(`ls`/`awk`)、`9.21_7.md`(`which`)、`9.21_8.md`(`ϵͳ�Ҳ���ָ����·����` = 系统找不到指定的路径)。**修复方向**：Windows 下按 `chcp` 结果转码（iconv-lite），或用 `cmd /d /s /c "chcp 65001>nul & <cmd>"` 统一 UTF-8；`runVerificationCommand` 用的 `spawnSync(..., encoding:'utf-8')` 有同样问题。
2. **模型不知道 shell 是 cmd.exe。** `run_command` 的描述只说「按 shell 语法解释」。代价实打实：`9.21_4.md` 跑 `ls -l … | awk | sort` 白费一次；`9.21_8.md` 连续用 `;`、`$?`、`/tmp`（→ `error TS5023: Unknown compiler option '--noEmit;'`、`系统找不到指定的路径`），同一个 `npx tsc --noEmit` 换了 4 种写法都没成功。**修复方向**：在 system prompt 或工具描述里明确平台与 shell（如「当前为 Windows cmd.exe，不支持 `;`/`$?`/`&&` 的 POSIX 语义」），或直接提供 `powershell` 执行通道。
3. **`&` 造成的假成功。** `9.21_8.md` 第 6 次调用 `npx tsc --noEmit > run_test/tsc_raw.txt 2>&1 & echo done` 返回 `success: true, exitCode: 0` —— cmd.exe 把 `&` 当分隔符，返回的是 `echo done` 的退出码，tsc 的失败被完全掩盖。工具应提示连接符语义，并在结果里区分「整条命令行退出码」。

**验收标准。** 造一个失败命令，其 stderr 为中文，断言模型收到的 error 文本可读（无乱码）；对 `... & echo done` 这类命令，结果中能看出被掩盖的真实退出码，或工具直接给出警告。

---

## 6. P0 · 决策回退与循环守卫（原始待办 4）

1. **防循环守卫对 `BatchAction` 完全失效。** `hasRepeatedActions()`（`agent.runtime.ts:414-428`）只看 `type === 'Action'` 且要求**连续 3 次 `tool` + `params` 完全一致**；`9.21_7.md` 的 14 次决策**全部是 `BatchAction`**，一次都不会进这个判断。同时模型每次只给 `curl` 的 format 串多追加一个 `%X`，`params` 就永远唯一 —— 于是它连续 16 次返回同一段含字面量 `%v/%V` 的无效输出，直到 60s 墙钟耗尽。另外该守卫只覆盖「失败」和「完全相同的成功」，不覆盖「成功但无进展」。**修复方向**：守卫覆盖 `BatchAction`；增加「同一工具家族 + 输出高度相似/无新增信息」的进展检测（对 `run_command` 可用「命令指纹 + 输出相似度」）。
2. **自动 replan 只「停下来报错」，不真的重新规划。** `agent.runtime.ts:603-608` 命中 `shouldAutoReplan()` 后直接把 `stopReason` 置为 `error` 并 `return false`。`9.21_8.md` 实测 stopReason 正是 `工具 run_command 连续失败 3 次，需要重新规划`，但整份 trace 里**没有任何 Replan 决策**，`plan.version` 仍是 1 —— 名字叫「需要重新规划」，行为却是「终止运行」。**修复方向**：真正走一次 replan（构造 Replan 决策交给 `handleReplan`），或在放弃前至少把失败上下文回灌给模型一次。
3. **失败计数语义与文案不符。** `shouldAutoReplan` 统计的是「同一工具 60s 窗口内失败次数」（`agent.runtime.ts:702-708`），不是连续失败。`9.21_8.md` 的失败发生在第 4、5、7 次调用，中间第 6 次是「成功」，仍被判定为「连续失败 3 次」。要么改成真正的连续计数，要么改文案。
4. **`Replan` 会丢掉整份历史计划。** `handleReplan`（`agent.runtime.ts:870-891`）保留的是 `steps.filter(s => s.status === 'completed')`，但**全仓库没有任何代码把步骤置为 `completed`**（只有 `handleReplan` 里置 `failed`，见 7.1），所以每次 replan 这个 filter 都是空集 —— 旧计划被整体丢弃，`currentStepIndex` 也退回到新步骤，已做的进展在计划视图里全部蒸发。

**验收标准。** (a) 构造「BatchAction 反复微调参数、成功但无进展」的用例，运行必须在超时前被守卫终止；(b) 构造「同一工具间歇性失败 3 次」的用例，运行真正产生一次 `plan.version = 2` 的 Replan 决策，而不是 `error` 停止；(c) replan 后旧计划中已完成/未完成步骤按预期保留。

---

## 7. P0 · 计划状态机与验收可信度

### 7.1 计划状态机形同虚设

- **步骤永不推进。** 全仓库搜索 `'completed'`：只有 `handleReplan` 的 filter、`formatPlanState()` 的图标、provider 的 schema 枚举，**没有任何赋值**。8 份 trace 的最终 state 里，所有步骤都是 `status: "pending"`、`currentStepIndex: 0`、`version: 1`。模型每轮看到的「当前计划」永远是全套 ⏳，它无法据此判断自己走到哪一步。
- 连 `9.21_6.md` 里被有意跳过的第 3 步（move 已兼顾删除）也没被标记，`9.21_2.md` 的 4 步在 `task_completed` 时仍是 4 个 pending。

**建议。** 给模型一个推进计划的入口（完成当前步 / 跳过 / 追加），或在每轮把 `currentStepIndex` 推进规则明确化；`formatPlanState()` 已能渲染 4 种状态，缺的只是写入方。计划状态必须进 state，供审计。

### 7.2 验收与交付物脱钩（「假通过」）

`verifyTask()`（`agent.runtime.ts:1095-1145`）的实现是：`inferVerificationCommands()` 扫描工作区的 `package.json` → 固定跑 `npm test`；有 `tsconfig.json` + 本地 tsc → 再跑类型检查；`passed: allPassed`。它回答的是「**这个仓库自带的 169 个单测还过不过**」，不是「**这个任务交付了吗**」。

后果在 trace 里非常明确：

- `9.21_7.md`（天气任务，`weather.md` 没产出、`fileChanges: []`）→ `passed: true`、`typeCheckPassed: true`、`diffSummary: "运行期间没有文件变更"`。
- `9.21_8.md`（tsc 任务，`typecheck.md` 没产出）→ `passed: true`，只有 `completionCriteriaMet: false` 隐约透露没完成。
- 反过来，`9.21_2.md` 的 `tools_list.md` 内容是错的（正文自相矛盾：既说「共有 1 个导出函数」又说「文件内没有 `export function`」，实际 `run_command.ts` 只有 `export class RunCommandTool`），却拿到 `passed: true, completionCriteriaMet: true`。
- 每次验收都跑完整 169 个单测（约 20s），对「写一个 md 文件」这类任务纯属浪费。

**建议。** 分两层：(1) 保留现有的「仓库回归」检查，但改名为 `regression`，不再冒充任务验收；(2) 新增交付物验收 —— 优先用任务自带的完成判据（`step.completionCriteria`），至少做到「断言声明的产物文件存在且内容匹配」（如 `run_test/tools_list.md` 含 `RunCommandTool`）。`completionCriteriaMet` 不应是可选项，它是唯一诚实的那一个信号。

**验收标准。** 重跑 `9.21_7.md`/`9.21_8.md` 两个任务，验收结论必须是「未通过」，且理由指出缺失的交付物；重跑 `9.21_2.md` 必须因产物内容不匹配而判处失败。

---

## 8. P2 · 任务测试工程化（原始待办 3）

**现状。** `run_test/` 是手工记录：`9.21.task.md`（10 个任务 + 测试点）+ 8 份人工粘贴的运行 trace。没有 runner、没有断言、没有评分。上面第 1.1 节的表格是靠人工读 JSON 数出来的。

**问题。** 无法回归。「改完之后有没有变好」目前只能靠人肉对比 trace；且 `verification` 混入了仓库自身的测试输出（`9.21_3.md` 里那段 `verification.testResults.output` 还嵌着另一次 mock 运行的完整 state，连 `promptTokens: 30` 和嵌套的 `stopReason` 都在里面），机器解析会认错。

**建议。** 把 10 个任务固化成可复跑的 eval 套件：

- `tasks.json`：每条含 `goal` / 平台前提 / 期望交付物（路径 + 内容匹配）/ 期望涉及的工具链路 / 时间与轮数上限（超时类任务尤其需要，任务 10「超时恢复」目前没有 trace）。
- runner：跑完输出 scorecard —— 通过率、每任务的 `promptTokens`/轮数/耗时、是否触发 replan、是否出现乱码、验收是否真的校验了交付物。
- 把 `9.21_1.md`~`9.21_8.md` 作为**基线快照**保留，后续改动与之对比。
- 清理 `9.21.task.md` 里引用已删除文件的过期任务（任务 2 的 `src/index.ts`），补上缺失任务 3、10。

**验收标准。** 一条命令产出 scorecard；8 个基线任务的通过/失败结论与本文第 1.1 节一致；故意改坏一处（如把 4.1 的 bug 重新引入）能被 scorecard 捕获。

---

## 9. P2 · 工具语义细节（逐条，均来自 trace 实测）

| # | 问题 | 证据 | 建议 |
|---|---|---|---|
| 1 | `read_file` 的 `truncated` 只反映 `maxChars` 截断，不反映「只读了 200 行」 | `9.21_2.md`：248 行的文件返回 `returnedLines: 200, truncated: false` | `returnedLines < totalLines - start + 1` 时也应置 `truncated: true`；字段名有歧义，建议改为 `charTruncated` + `moreLines` |
| 2 | `run_command` 的成功只看整条命令行的退出码 | `9.21_8.md` `... & echo done` → `success: true`；`9.21_7.md` 16 次 curl 均 `exitCode 0` 但输出含字面量 `%v`（wttr.in 不支持的占位符） | 结果区分「命令行退出码」与「目标命令退出码」；对空输出、含未替换占位符的输出给出提示 |
| 3 | `read_directory` 的 `maxItems` 是**全局 DFS 计数**，会被 `node_modules` 吃光 | `9.21_7.md`：`path=".", maxDepth=2` 返回 123,264 字符、`total: 2`，根目录下只剩 `node_modules`，`src`/`openspec`/`package.json` 全部消失 | 默认忽略 `node_modules`/`.git`/`dist`（`search_code` 已经这么做了，`search_code.ts:103`），或把 `maxItems` 改成每层配额；描述里写明这些默认值 |
| 4 | `list_files` 与 `read_directory` 能力重叠 | `9.21_4.md`：两者返回同一批 13 个名字+大小（约 2.8KB 重复进历史）；`9.21_6.md`：`list_files` 被无用调用两次 | 合并或明确分工（`list_files` 负责筛选+大小，`read_directory` 只给层级），描述里写清「不要同时调用」 |
| 5 | `BatchAction` 并发执行、无依赖排序 | `9.21_6.md`：批次里 `list_files(".")` 与 `create_file` 并发，观测时间戳 1789983769914 < 1789983769916，列举发生在写入之前，信息无效 | 批次内声明 `dependsOn`，或对「先读后写」的组合串行执行 |
| 6 | `fetch_url` 只返回原始字符串，无结构化解析 | `9.21_5.md`：`contentType: application/json`，但模型要从文本里自己抠 `"url"` 字段 | 按 `contentType` 附带 `parsedJson`（成功解析时），并支持 JSONPath 式提取；大响应保持截断 |
| 7 | `git_operation log` 只返回 7 位短 hash、无格式控制 | `9.21_3.md` 最终答案里模型不得不自行声明「日志只给了短 hash，需要 40 位请自己跑 `git log -3 --format=%H%x09%s`」 | 提供 `format`/`fullHash` 选项，或 `limit` 之外允许 `--pretty` 透传 |
| 8 | 工具描述里缺平台/环境约束 | `9.21_4.md`、`9.21_8.md` 因 POSIX 语法浪费调用 | 见第 5 节第 2 条 |

---

## 10. P2 · 可观测性（trace 自身的可信度）

1. **观察存的是原始未截断输出，与「真正发给模型的内容」不一致。** `9.21_7.md` 的 `read_directory` 观察是 123,264 字符，而 `toToolResultMessage()`（`agent.runtime.ts:992-1030`）会把同一份数据按 `read_directory.outputBudget = { maxChars: 12000, maxLines: 400 }` 截断后才发给模型 —— trace 里既看不到截断标记，也看不到模型实际收到的版本。建议同时记录 `rawLength` 与 `sentContent`（或至少记录截断标记），否则「token 花在哪」永远无法事后归因。
2. **`verification.testResults.output` 污染 trace。** 它把 vitest 的全量输出（含 ANSI、以及嵌套的另一次运行 state 与 `DEBUG` dump）塞进每份 trace，`9.21_3.md` 里甚至出现嵌套的 `stopReason`，解析时容易认错对象。建议验收只保留计数 + 失败摘要 + fullOutputFilePath。
3. **`promptTokens` 是累计值，容易被误读。** 它按轮累加（`agent.runtime.ts:256`），所以「为什么能到几万」有一半是口径问题：8 份 trace 里它都是「所有轮次之和」，单轮真实开销看 `contextSize`。建议输出时同时标注两个口径（代码注释里已区分，UI 未体现）。
4. **审批与计划不进 state。** 见第 3、7 节 —— trace 目前无法回答「谁批了什么」「走到第几步」，这两类信息是事后审计的核心。
5. **缓存命中信息被丢。** 见 2.5。

---

## 11. 建议实施顺序

| 批次 | 内容 | 理由 |
|---|---|---|
| 第 1 批（P0，改动小、收益立刻可见） | 4.1 `search_code` 一行修复 + 4.2/4.3 `fs-guard` 统一；5.1 编码修复；7.2 验收分层 | 前两项是正确性与安全缺陷，后两项直接决定「跑一次能不能信」 |
| 第 2 批（P0） | 6.1/6.2/6.3/6.4 循环守卫与真 replan；7.1 计划状态机；3.1/3.2/3.5 审批审计、默认拒绝、超时兜底 | 回退与审批是「敢不敢放开手让它跑」的前提 |
| 第 3 批（P1） | 第 2 节 token 治理（工具声明瘦身、上下文裁剪、缓存透传） | 需要先有第 8 节的 eval 才能验证没有跑偏 |
| 第 4 批（P2） | 第 8 节 eval 套件；第 9 节工具语义；第 10 节可观测性 | 工程化与体验打磨 |

---

## 附录 A · 原始待办对照

`PRD.md` 原有 4 条，全部已展开并定位到证据：

```
1. Prompt Token开销为什么这么大，见run_test目录测试   → 第 2 节
2. 执行审批怎么做                                     → 第 3 节
3. 任务测试run_test                                   → 第 8 节
4. 决策回退                                           → 第 6 节
```

## 附录 B · 本次核对方式

- 逐份读完 8 个 trace（`9.21_7.md` 4050 行分段读），提取原始数字与逐字错误串。
- 现场核对源码：`run_command.ts`、`read_directory.ts`、`read_file.ts`、`search_code.ts`、`agent.runtime.ts`、`deepseek.provider.ts`、`types/Runtime.ts`、`types/AgentProvider.ts`、`tools/index.ts`、`cli/composable/useAgent.ts`。
- 两次实测探针（用 `npx tsx` 跑，已删除）：`baseTools()` 声明体积测量；`search_code` 路径边界与 `read_file` 越权读取复现。
- 未验证项已在正文标注（如 `fetch_url` 对 HTML 的处理方式，因 trace 只覆盖 JSON 场景而无法判定）。
