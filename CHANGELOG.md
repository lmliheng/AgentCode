
# feat: standard IO MCP（2026-08-03 13:32:12 +0800）

本次提交实现了完整的 MCP 标准 IO 示例：包含 DeepSeek 客户端、售后 MCP Server（工具、资源、Prompt）、Host 调度循环及验证脚本。核心功能是订单查询与退款预检，通过 stdio 传输，具备工具名白名单、参数校验、最大轮次控制等安全机制。代码注释详尽，错误处理较完善，可作为 MCP 教学样板。可扩展 HTTP 传输、流式响应、接入真实数据库等。整体质量较高，但存在文件名拼写不一致（cilent/client）的小问题需修正。
## feat: stramableHttp - 2026-08-03 23:15:27

本次提交实现了 DeepSeek 与高德 MCP 的 Streamable HTTP Tool Calling 集成：`host.js` 连接高德 MCP，将工具 schema 转为 OpenAI functions 格式，通过最多 20 轮循环执行工具并回填结果；`deepseek-client.js` 封装模型请求并统计耗时与用量；新增消息工具和依赖配置，删除空测试文件。可扩展通用多 MCP/模型桥接、流式输出、并行工具调用与会话管理。整体链路完整、注释清晰，属可用原型；但存在标题拼写 `stramable`、导入路径缺 `.js`、`role` 参数未使用、缺少异常处理与测试等问题，质量中上，需打磨。
## docs：readme（2026-08-04 00:15:03 +0800）

**提交哈希**：`4bc6554306e42bddec6d6436f8d4eec7139dd1f2`

新增 `README.md`，为 AgentCode 项目首次建立完整说明文档。内容涵盖项目定位（DeepSeek + MCP 学习实践）、DeepSeek 客户端封装、本地 stdio MCP 售后退款场景、远程 HTTP MCP 高德地图、Tool Calling 流程梳理，并补充目录结构、运行命令与技术要点。整体结构清晰，能帮助快速了解项目全貌。

**可扩展**：可补充架构图、环境依赖与版本锁定、API Key 获取步骤、运行截图、常见问题 FAQ、后续 roadmap 及贡献指南。

**工作质量**：文档覆盖较完整，条理清楚，作为项目入口文档合格；但安装依赖细节、异常排查和示例输出可进一步细化。
```md
## feat: 向量模型和向量检索器（2026-08-05 16:08:44 +0800）

本次提交搭建了向量模型与向量检索器基础能力。工作包括：接入智谱 embedding-3 生成 256/512/1024 维向量；基于内存文档构建向量索引，用余弦相似度完成相似问题检索；并将 DeepSeek 客户端改为命令行多轮对话，修复 messageAdd 返回值。可扩展为持久化向量库、支持 PDF/Word 解析、集成 RAG 问答闭环。整体质量良好，流程已跑通；但文件命名不一致、文档硬编码、错误处理与测试仍可改进。
```
## feat: 资料解析清洗分块，设置metadata json格式（2026-08-05 18:05:00 +0800）

本次提交新增 `build-chunks.js`，完成 Markdown 资料读取、文本清洗、标题及 category/owner/version 元信息解析，并按最大 120 字符、40 字符重叠切分 Chunk，生成含稳定 `chunkId` 和 `metadata` 的 `chunks.json`；同时补充退款、发货示例文档，更新 VectorRetriever 测试问题为售后场景。

可扩展方向：支持 PDF/Word 等格式、按 Token 计数切分、接入 Embedding 和向量库，以及增量更新与元数据过滤检索。

工作质量：代码结构清晰、注释完整，输出格式规范；但按字符固定切分可能切断语义，元信息解析较简单，建议补充测试和更智能的分块策略。
# feat: milvus connection, collections create（2026-08-06 16:45:17 +0800）

本次提交完成 Milvus 向量库接入与集合创建：新增 `milvus-rag-store.js`，实现智谱 Embedding 生成、Collection 创建/加载、批量写入、检索及退款规则更新；拆分 `connect.js`、`database.js`、`collection.js` 模块，配置 npm 脚本。另修复 `similarityMethod.js` 零向量判断逻辑，调整 `VectorRetriever.js` 测试问题。整体质量中上：核心流程完整、注释清晰，但 `collection.js` 未完成、`index.js` 为空，仍偏实验。可扩展为 Embedding 分批、元数据过滤、检索重排和自动化测试。
## feat: fileSystemMCP init - 2026-08-06 17:34:21 +0800

本次提交初始化了 FileSystem MCP 的 Node 模块，新增 `fs.js`、`path.js`、`process.js` 和 `package.json`，演示文件读取、路径解析和进程信息获取。同时将高德相关脚本迁移到 `MCP/MCP/高德` 目录。另外扩展了 `Milvus/index.js`，定义了销售集合的 Schema、自动建集合与加载逻辑，并加入 `insertChunks`、`toRow` 等向量写入准备代码。可扩展：实现完整 MCP 文件系统工具，接入 Embedding API 打通 chunk 导入闭环。工作质量：基础框架搭建清晰，但 Milvus 部分存在明显未完成代码和变量声明错误，需修复后才能正常运行。
## feat: milvus chunk写入collection，检索测试（2026-08-06 20:06:31 +0800）

本次提交主要实现了 Milvus 向量库的 Chunk 写入与检索测试。在 `index.js` 中：引入 `embeddingZ` 模型，读取 `chunk.json` 后批量生成向量并写入 `sale` 集合；新增 `ensureOk` 统一校验 Milvus 响应；新增 `searchQuestion` 方法，支持基于 embedding 字段的 ANN 检索、`filter` 元数据过滤及指定返回字段，并通过 `--search` 参数触发测试查询。`package.json` 拆分出 `init` 和 `search` 脚本。同时清理了 `path.js` 多余空行，新增提问优化器笔记占位。

**可扩展**：将硬编码的问题和过滤条件参数化，封装为 API 或 CLI 参数；增加相似度阈值、批量查询、结果缓存及错误重试机制；完善提问优化器的 rewrite-query / multi-query 实现。

**工作质量**：功能闭环完整，写入与检索流程清晰，错误处理有一定封装。但查询参数硬编码、部分代码可复用性不足，仍有优化空间。
## feat: 提示词rewrite和muiliti处理（2026-08-06 21:46:36 +0800）

- **做了什么**：新增 `RAG/提问优化器/query.js`，利用 DeepSeek 将用户口语化提问改写为标准语句，并生成最多 6 个多角度相似问题，用于增强 RAG 检索；在 `package.json` 中增加 `ask` 测试脚本；删除旧拼写文件 `deepseek_cilent.js`，统一迁移至 `deepseek_client.js`。  
- **可扩展**：可进一步解析返回 JSON、输出结构化对象、与向量检索器串联、支持批量查询。  
- **质量**：模块划分清晰，中文注释完整，交互式测试友好；但提示词硬编码在代码中，且 `muiliti` 拼写有误，后续可优化。
## feat: 多路召回-混合检索，在向量检索的基础上加上BM25算法增加关键词检索（2026-08-06 22:04:31 +0800）

**工作内容**：新增 `RAG/混合检索/` 目录，创建 `BM25.js`、`MaxinSearch.js` 占位文件，并用 `note.md` 记录混合检索目标：在 ANN 向量检索基础上加入 BM25 关键词检索，通过重排序生成新 TopK，提升召回率。

**可扩展**：实现 BM25 打分、混合排序与 RRF/加权融合策略，补充效果对比评测。

**工作质量**：目前仅为注释占位和思路文档，未落地可运行代码，属于起步阶段；方向清晰，但完整度不足。
## feat: 重排序模型（2026-08-06 22:04:54 +0800）

本次提交新增 `RAG/reRank/rerank.js`，目前仅包含文件头注释，说明该模块用于对检索后的数组进行再次排序，并计划使用 rerank 文本模型完成任务。

工作内容停留在初始化与意图声明阶段，尚无实际可运行代码，功能未落地；但目录与命名清晰，便于后续开发。可扩展方向包括：接入 rerank 模型 API、定义输入输出结构、支持批量处理与异步调用、增加错误处理与降级策略，并补充单元测试评估排序质量。整体属于轻量起步提交，为后续重排序能力预留了入口，工作质量作为占位骨架合格，但距离可用功能仍有较大差距。
## feat: FileSystem MCP server 2 tools（2026-08-07 03:50:35 +0800）

本次提交新增 FileSystem MCP Server，基于 `@modelcontextprotocol/sdk` 注册 `list_disks` 和 `read_directory` 两个工具，提供磁盘列表与目录读取能力。同时添加 `design.md` 规划后续工具（应用列表、目录大小、磁盘空间、进程列表等），整理 host 相关文件并补充测试脚本与 workspace 配置。

**可扩展**：可增加文件内容读取、递归遍历、权限校验、符号链接处理，并用 PowerShell/CIM 替代已弃用的 `wmic`。  
**工作质量**：模块划分清晰，包含基础错误处理与测试；但测试断言较弱，`wmic` 兼容性存在风险，部分工具函数尚未完成。
## feat：Rerank模型（2026-08-07 09:10:07 +0800）

本次提交加入 Rerank 重排序能力：新增 `reRank/rerank.js` 调用智谱 rerank API 对文档二次排序；新增 `search_result.js` 保存检索样例；`VectorRetriever.js` 导出 `documents` 并将测试逻辑改为条件执行；`package.json` 新增 rerank 脚本；Milvus 检索 limit 由 3 改为 4，输出改为表格。整体跑通测试流程，但 query、检索结果与输入文档多处硬编码，尚未真正接入 Milvus 检索结果。可扩展为参数化查询、动态文档输入、接入真实检索结果，并补充错误处理与模型配置，提升通用性。
## feat: reRanK是对向量检索结果的重排（2026-08-07 09:33:44）

本次提交将 rerank 流程中的 `query` 从硬编码改为从 VectorRetriever 导出的 `question`，并统一使用 `search_res` 作为重排输入；更新了静态检索结果数据，优化测试输出（增加 `chunkHash`、展示用户问题）。工作质量较好，减少了硬编码，增强了模块间数据一致性，但静态 `search_result.js` 仍为 mock 数据，且 `Milvus/index.js` 中 `import` 放置位置不规范。可扩展：将 `search_res` 改为动态获取真实向量检索结果，打通“检索→重排”端到端流程，并补充自动化测试。
## Merge branch 'main' of https://github.com/lmliheng/AgentCode（2026-08-07 09:33:50 +0800）

**工作内容：**  
本次提交合并了 main 分支，新增 `MCP/FileSystem` 目录，基于 `@modelcontextprotocol/sdk` 实现了 `list_disks`、`read_directory` 两个 MCP 工具，并补充 `design.md` 设计文档、`package.json`/锁文件及基础测试。同时将原高德 MCP 客户端相关文件迁移至 `MCP/host`，并配置了 Yuque MCP 服务。

**可扩展：**  
可继续实现设计文档中规划的 `get_installed_apps`、`get_directory_size`、`get_drive_space`、`get_process_list` 等工具；增加文件内容读写、路径权限校验、跨平台支持，替换当前依赖 Windows 的 `wmic` 命令。

**工作质量：**  
模块划分清晰，错误处理和输出格式较规范，测试初步覆盖核心函数；但磁盘枚举依赖 Windows `wmic` 且已过时，兼容性一般，测试断言不够严谨，设计文档与实现仍有差距，整体质量中等偏上。
## feat: 将 Filesystem 作为 npm 库提交（2026-08-11 21:55:13 +0800）

`a46f6e7bb4f9e8b503bedd6cd88d2bc1490356e1`

本次将 FileSystem MCP 服务整理为 npm 库：包名改为 `@lmliheng/filesystem` 并升级至 1.0.3，配置公共仓库发布，入口改用 `index.mjs`，新增 shebang、`bin` 命令及发布文件白名单；同时新增 VS Code 工作区配置并清理 `all.json` 空行。可扩展 README、自动发布 CI 与更多测试。整体方向清晰、改动规范，但缺少文档与变更说明，后续可维护性可再提升。
## feat: ReAct Loop（2026-08-16 23:36:07 +0800）

本次提交新增 ReAct 相关笔记，核心是在 `ReAct/ReAct.md` 中梳理 ReAct Loop 概念，说明 Action 与 Observation 的交互关系，并提出 Plan-and-Execute、Replanning 以及 Plan State 结构化数据设计。同时初始化 AgentRuntime、ReActLoop、Plan_and_execute、langChain 等模块说明，但多数内容仍为占位。整体质量处于概念设计阶段，思路清晰，但缺少可运行实现，且 `Plan_and_excute` 存在拼写错误。后续可扩展为基于 Plan State 实现运行时循环、资源消耗统计、重规划触发机制及工具调用协议。
```md
## feat: ReAct Agent（2026-08-17 06:34:53 +0800）

本次提交实现最小可运行 ReAct Agent：新增 Agent 循环与 Tool Calling 调用，内置服务健康、指标、日志、部署、数据库连接池 5 个只读工具，并提供“版本回归”“连接池耗尽”两类模拟故障场景。同时重构 LLM 客户端，拆分普通对话与工具调用，新增余额查询命令。代码模块清晰，含 Zod 参数校验、错误处理和步数保护。可扩展真实监控/日志工具接入、轨迹持久化、动态执行预算与 Plan-and-Execute。质量中上，但 context_budge 仅占位未实现、缺少测试、部分命名不一致。
```
## Merge branch 'main' of https://github.com/lmliheng/AgentCode - 2026-08-17 07:53:19 +0800

本次合并主要完善了 MCP FileSystem 项目的发布与命令行配置。新增 `AgentCode.code-workspace`，统一 VS Code 工作区设置；为 `index.mjs` 添加 shebang，使其可作为 CLI 直接执行；`package.json` 将包名改为 `@lmliheng/filesystem`，版本升至 1.0.3，并补充 `bin`、`files`、`publishConfig` 等字段，便于发布到 npm 公共仓库；同时清理了 `all.json` 的多余空行。整体工作质量较好，配置规范，具备实际发布与使用价值。可进一步扩展为包含更多文件系统操作工具、添加自动化发布脚本或补全测试用例。
## feat: changlog — 2026-08-17 08:07:16 +0800

**做了哪些工作：**  
新增 `CHANGLOG.md`，记录并总结了此前三次提交；新增 `package.json` 与 `package-lock.json`，声明项目描述、依赖 `@lmliheng/ai_git` 并配置 `comsume` 脚本；新增 `scripts/ai_git.js`，调用 `git_ai.ai_commsume` 来生成变更日志。

**可扩展：**  
可将脚本扩展为完整 CLI，支持指定分支、时间范围并自动追加日志；也可接入 CI 流程自动维护更新。

**工作质量：**  
工程结构简洁，依赖与脚本配置完整，自动生成日志的思路清晰；但脚本缺少参数校验和异常处理，自动生成链路尚未充分测试，仍有改进空间。
## docs: 更新Reame（2026-08-17 09:15:43 +0800）

本次提交重写了 `README.md`，将原来按“已完成工作/目录结构/运行方式”展开的详细说明，改为项目定位、技术要点和功能模块表格三部分。新增了 RAG、ReAct、Context 等模块状态说明，突出“LLM 客户端 → MCP → RAG → ReAct”完整技术链路，并标注 Context 模块仍为占位。

可扩展方向：可补充架构图、各模块快速开始命令、Context 模块落地说明，以及常见问题示例；也可为高德、RAG 等模块增加独立文档链接。

工作质量：文档结构更简洁清晰，模块状态一目了然，信息密度更高；但标题“Reame”存在拼写错误，且运行示例被删减，新读者上手可能稍慢，建议后续修正并补充快速上手内容。
# feat: AgentRuntime（2026-08-17 19:43:40 +0800）

本次提交新增 `AgentRuntime` 运行时，实现 Agent Run State、执行预算、终止条件、轨迹与证据记录，并通过 `demo.js` 验证完成、重复 Action、无进展、预算耗尽四类场景。同时重构 DeepSeek 客户端，将 temperature、thinking 等改为 `options` 透传；重命名 FileSystem MCP 包为 `@lmliheng/filesystem-mcp`，新增 `plan_Agent.js` 占位。整体结构清晰、注释完整，运行时边界设计合理。可扩展接入真实模型、联动 plan_Agent；需修正失败状态被记为 stopped、根依赖仍指向旧包的问题。
## feat: langchain（2026-08-17 21:21:09 +0800）

本次新增 LangChain 示例：接入 DeepSeek 并创建订单客服 Agent，定义 `get_order_status` 工具，跑通“提问 → Tool Call → 返回结果”；同时新增子包依赖、整理 MCP 目录、更新笔记并精简根依赖。可扩展：接真实订单库、多工具编排、流式输出、接 MCP 工具、补错误处理与 Key 校验。质量：结构清晰、注释到位，能说明核心链路；但仍是模拟数据，订单号硬编码，缺少测试与运行防护。
## feat: langchain sdk — 2026-08-18 06:42:39 +0800

本次提交新增 `langchain.js` 与 `langchain_deepseek.js`，并在 `package.json` 中注册 `generate`、`chat` 两个脚本。核心工作是实现基于 DeepSeek 模型的命令行对话：单轮 `--generate` 直接调用 `invoke` 问答，多轮 `--chat` 通过 `message_tools` 维护上下文，支持连续交互。  
工作质量属于初步骨架：多轮对话逻辑基本可用，但 `langchain.js` 中 `createAgent` 仅为空壳，工具调用（`--tool`）尚未实现，缺少错误处理与退出机制。  
可扩展方向：完善工具调用、支持流式输出、会话持久化、模型参数可配置、增加系统提示词等。
## feat: langchain LLM message/chat/tool - 2026-08-19 00:56:18 +0800

**工作内容：**  
封装 DeepSeek 模型创建，新增 `--message` 多轮对话与 `--tool` 工具调用模式；注册目录读取、磁盘名工具，手动完成 Tool calling 循环并正确组装 `AIMessage`/`ToolMessage`。同时整理并发布 `@lmliheng/filesystem-mcp` 包，使用 Rollup 打包，暴露 `dirRead`、`disk_name`。

**可扩展：**  
继续增加文件读写、进程等 MCP 工具；将手写工具循环抽象为 Agent 或 LangGraph；引入 `SystemMessage` 改善对话角色。

**工作质量：**  
实现完整、注释清晰，依赖管理规范；但工具调用仍为手写 `switch` 分发，较初级，可进一步提高复用性。
## feat: RAG chunk for md,pdf,docx（2026-08-21 01:07 +0800）

> commit：`72b4b174b8020e9cb6f8dad65d3ed3635474a07e`

### 做了哪些工作
把 RAG 资料分块从单一 Markdown 扩展为可发布模块：重构 `src/markdown` 与新增 `src/pdf`，实现 Markdown 解析分块和 PDF 文本解析分块；补充 Rollup 打包、npm 发布配置、CLI 命令；新增 `FileSystemMCP-design.md`、`resume.pdf`、`报告.docx` 测试文档；混合检索部分新增基于 Milvus 的 Dense、BM25、Weighted、RRF 完整 Demo。

### 可以扩展什么
可补全 docx 解析逻辑，优化跨平台路径校验，增加批量文档入库、增量更新、错误抛出与单元测试，统一 PDF 与 Markdown 的写入行为。

### 工作质量怎么样
Markdown 分块流程清晰，元数据、稳定 ID 和 overlap 设计较完整；但 docx 仍是空壳，路径校验仅支持 Windows，错误处理只打印日志，PDF 写入为覆盖式，工程质量中等偏上，仍有较多细节需要打磨。