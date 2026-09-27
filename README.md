### AgentCode

一个 Agent 应用的学习与实战仓库：`packages/` 里是可独立安装 / 发布 / 测试的包，
`examples/` 里是学习示例与资料（不进 workspace，用 `tsx` / `node` 直接跑）。

#### 目录

```
packages/
  core/          @lmliheng/acode-core      共享类型、输出预算、会话持久化的零依赖地基
  providers/     @lmliheng/acode-providers 模型适配层：deepseek / openai / anthropic / gemini
  tools/         @lmliheng/acode-tools     文件 / Git / 命令 / 搜索工具与 ToolRegistry
  runtime/       @lmliheng/acode-runtime   ReAct 循环、审批、预算
  cli/           @lmliheng/acode           交互式 CLI（bin: acode），vue-tui 实验入口
  rag-chunk/     @lmliheng/rag-chunk       RAG 资料读取 / 分块 / 向量化 / Milvus
  myrag/         myrag                     分块实现的实验场地（spike）
  mcp-host/      host-client-server        MCP host / client 示例服务
  mcp-wxcloud/   wxcloudmcp                微信云托管上的 MCP 示例
  memory-short/  02-short-term-memory      短期 / 长期记忆示例
examples/        学习示例（llm / langchain / context / mcp / memory / prompt / react / rag）
scripts/         辅助脚本（ai_git.js 等）
```

包之间的依赖是无环的：`core ← providers / tools ← runtime ← cli`。

#### 常用命令

```bash
pnpm install
pnpm typecheck          # 所有包 tsc --noEmit
pnpm test               # 所有包 vitest
pnpm build              # 需要发布的包产出 dist/

pnpm --filter @lmliheng/acode cli   # 以 tsx 直接跑 packages/cli 的源码（开发用）
pnpm chat:llm                       # 跑 examples/llm 里的示例（其余脚本见 package.json）
```

需要模型 API Key 的示例与 CLI 从 `.env` 读 key：根目录（示例）、`packages/cli`
与 `packages/rag-chunk` 各有一份 `.env.example`，复制成 `.env` 填上 `DEEPSEEK_API_KEY` 即可。

#### 发布

要给 npm 的包（`core` / `providers` / `tools` / `runtime` / `cli`）都配了
`build` + `files: ["dist"]` + `publishConfig`：仓库内开发直接消费 `src`
（`exports` 指 `src/index.ts`，`tsx` / `vitest` / `tsc` 都跑得通），
`pnpm publish` 时 `publishConfig` 会把入口改写成 `dist`，因此装到别人机器上是正常包。

```bash
pnpm build && pnpm -r publish --access public   # 按依赖顺序：core → providers/tools → runtime → cli
```
