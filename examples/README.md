# examples —— 学习示例与资料

这里是仓库里的**学习资料与可运行示例**，不是 pnpm workspace 的成员
（workspace 只覆盖 `packages/**`，见根目录 `pnpm-workspace.yaml`）。

- 每个子目录是一类主题：`llm`（DeepSeek 直连）、`langchain`、`context`（上下文预算）、
  `mcp`（MCP 客户端/服务端与工具调用）、`memory`（长期记忆）、`prompt`（提示词）、
  `react`（ReAct 循环与多智能体）、`rag`（向量模型、检索器、重排、混合检索、Milvus）。
- 跑法：从仓库根目录用 `tsx` 直接跑，例如 `pnpm rerank:rag`、`pnpm chat:llm`
  （常用命令见根 `package.json` 的 scripts），或自己 `pnpm exec tsx examples/<主题>/<文件>.ts`。
- 这些示例没有独立的 `package.json`，依赖统一从根 `node_modules` 解析；
  需要 API Key 的示例通过 `--env-file=.env` 读取根目录的 `.env`（见 `.env.example`）。
- 真正可独立安装/发布的包在 `packages/`：`cli`（`@lmliheng/acode`）、`core`、`providers`、
  `tools`、`runtime`、`rag-chunk`、`myrag`、`mcp-host`、`mcp-wxcloud`、`memory-short`。
