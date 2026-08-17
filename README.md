基于 **DeepSeek 大模型** 的 AI Agent 学习与实践项目，用可运行的 Node.js（ESM）代码覆盖 Agent 完整技术链路：**LLM 客户端 → MCP 工具协议 → RAG 检索增强 → ReAct 推理循环**。

## 技术要点

- **MCP 三要素**：Server 暴露能力、Client 负责通信、Host 负责调度（发现能力 → 转换工具 → 调模型 → 执行工具 → 回填上下文 → 再次调模型，直到模型不再请求工具）。
- **工具格式转换**：MCP Tool 的 `inputSchema`（JSON Schema）与模型工具参数结构一致，Host 只需剥离 `$schema` 并包装为 `type: 'function'`。
- **Tool Calling 循环**：模型返回 `tool_calls` → 本地执行 → 以 `role: tool` 回填 → 再次调用模型，直到 `tool_calls` 为空。
- **ReAct**：模型根据 Observation 决定下一步 Action；本项目每一步只调用一个工具，最多 8 步防死循环，工具参数用 zod 校验，只读工具不允许模型声称已执行变更操作。
- **RAG 链路**：分块 → 向量化（智谱 embedding-3）→ Milvus 检索 → 可选重排 / 混合检索（BM25）→ 提问优化（rewrite / multi-query）。

## 功能模块

| 模块 | 说明 | 状态 |
| --- | --- | --- |
| [`LLMclients/`](LLMclients/) | DeepSeek API 封装：对话、Tool Calling、余额查询，含 CLI | ✅ |
| [`MCP/`](MCP/) | MCP 协议实践：本地 stdio、远程 StreamableHTTP、FileSystem Server | ✅ |
| [`RAG/`](RAG/) | 检索增强：分块、向量化、Milvus 检索、重排、混合检索、提问优化 | ✅ |
| [`ReAct/`](ReAct/) | ReAct Agent：推理-执行循环与故障排查场景 | ✅ |
| [`Context/`](Context/) | 上下文预算控制 | 🚧 占位 |
| [`scripts/`](scripts/) | 基于 ai_git 自动生成 CHANGLOG | ✅ |
