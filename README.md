# AgentCode

基于 **DeepSeek 大模型 + MCP（Model Context Protocol）** 的学习与实践项目。目标是把「模型调用外部工具」的完整链路跑通：从本地 stdio 传输的 MCP Server / Host，到基于 StreamableHTTP 的远程 MCP（高德地图），并封装了 DeepSeek API 客户端与 Tool Calling 循环。

## 已完成工作

### 1. DeepSeek 客户端封装（`LLMclients/`）

封装 DeepSeek Chat Completions 接口，是整个项目的基础能力层：

- `deepseek_client.js`：提供 `callDeepSeek(messages)` 发起对话，返回模型消息、停止原因、接口耗时和 Token 用量统计；同时提供 `getDeepseekBalance()` 查询账户余额，支持通过 `.env` 配置 API Key、Base URL 和模型名（默认 `deepseek-v4-flash`）。
- `chat.js`：调用余额接口的测试脚本。
- `message_tools.js`：对话消息的构造工具（`messageCreate` / `messageAdd`），支持单轮与多轮消息格式。
- `.env`：API Key 配置入口。

### 2. 本地 MCP Server + Host（`MCP/host-client-server/`）

以「企业售后退款」为业务场景，实现了基于 **stdio 传输** 的本地 MCP 完整链路，覆盖 MCP 的三大核心能力：

- **Server（`after-sales-mcp-server.js`）**：
  - 注册 2 个 Tools：`get_order`（查询订单）、`check_refund_eligibility`（退款预检）；
  - 注册 1 个 Resource：`refund-policy`（售后退款规则，Markdown 文本）；
  - 注册 1 个 Prompt：`refund-review`（退款审核回复模板）。
- **业务系统（`order-system.js`）**：用内存 Map 模拟企业订单系统，实现订单查询与退款资格判断（生鲜不支持无理由退款、签收超 7 天不可退、金额超 2000 元需人工审核等确定性规则）。
- **退款规则（`refund-policy.js`）**：以 Resource 形式暴露的售后政策文本。
- **Host（`host.js`）**：MCP 架构中的调度中枢，负责创建 MCP Client、发现 Server 能力、把 MCP Tools 转换成模型 Tool Calling 格式、调用 DeepSeek、执行模型提出的工具调用并把结果回填上下文，最多循环 4 轮防止死循环。支持 `--discover` 模式只验证能力发现，不调用模型。
- **验证客户端（`verify-client.js`）**：逐一验证 Server 的能力列表、工具调用、资源读取、Prompt 获取，以及未知订单的容错处理。

### 3. 远程 MCP 调用（`MCP/HTTP-MCP/高德/`）

在本地 stdio 基础上更进一步，基于 **StreamableHTTP 传输** 连接远程 MCP Server：

- `host.js`：通过 `StreamableHTTPClientTransport` 连接高德地图 MCP，利用 DeepSeek Tool Calling 让模型自动发现并调用高德暴露的地图工具（地点搜索、路线规划等），把 MCP 能力封装成可被模型自主决策的工具集。
- 复用了 DeepSeek 客户端与 message 工具，`.env` 中通过 `AMAP_MCP_URL` 配置远程 MCP 地址。

### 4. Tool Calling 原理梳理（`MCP/ToolCalling/`）

记录了 Tool Calling 的核心思路：把 Tools / Resources / Prompts 作为能力清单告诉模型，模型在响应中返回需要调用的工具（`tool_calls` 数组），Host 本地执行后把结果加入上下文，如此循环直到模型不再需要调用工具。

## 目录结构

```
AgentCode/
├── LLMclients/                  # DeepSeek API 客户端封装
│   ├── deepseek_client.js       # 对话调用 + 余额查询
│   ├── chat.js                  # 余额测试脚本
│   ├── message_tools.js         # 对话消息构造工具
│   └── .env                     # API Key 配置
└── MCP/                         # MCP 相关实践
    ├── mcp.md                   # MCP 概念笔记（host / client / server）
    ├── host-client-server/      # 本地 stdio MCP：售后退款场景
    │   ├── after-sales-mcp-server.js  # MCP Server（Tools / Resource / Prompt）
    │   ├── order-system.js            # 订单系统与退款规则
    │   ├── refund-policy.js           # 退款规则资源
    │   ├── host.js                    # MCP Host + Tool Calling 循环
    │   ├── verify-client.js           # MCP Client 能力验证
    │   ├── deepseek-client.js         # 带 tools 的 DeepSeek 客户端
    │   └── package.json
    ├── HTTP-MCP/高德/           # 远程 StreamableHTTP MCP：高德地图
    │   ├── host.js              # 连接远程 MCP + Tool Calling
    │   ├── deepseek-client.js
    │   ├── message_tools.js
    │   └── .env                 # 含 AMAP_MCP_URL 配置
    └── ToolCalling/             # Tool Calling 原理笔记
```

## 运行方式

各目录需先安装依赖（`npm install`）并配置 `.env`：

```bash
# 本地 stdio MCP
cd MCP/host-client-server
node --env-file=.env host.js "订单 A1024 是否满足退款条件？"   # 完整 Host 流程
node host.js --discover                                          # 仅验证能力发现
node --env-file=.env verify-client.js                            # 验证 Client 能力

# 远程 HTTP MCP（高德地图）
cd MCP/HTTP-MCP/高德
node --env-file=.env host.js
```

## 技术要点

- **MCP 三要素**：Server 暴露能力、Client 负责通信、Host 负责调度（发现能力 → 转换工具 → 调用模型 → 执行工具 → 回填上下文 → 再次调用模型）。
- **MCP Tool 与模型工具的转换**：MCP 与模型接口都用 JSON Schema 描述参数，Host 只需调整外层结构（`type: 'function'`），无需重写参数 Schema。
- **确定性规则与模型的边界**：订单查询、退款预检等业务逻辑放在 MCP Server 中，模型不直接判断，只负责基于工具结果生成回答。
- **传输方式演进**：本地场景使用 stdio 子进程通信；远程场景使用 StreamableHTTP，一个 Host 即可连接任意 HTTP 地址的 MCP Server。
- **安全细节**：Host 不直接信任模型返回的工具名，只允许调用本次能力发现获得的工具；stdio 模式下调试日志输出到 stderr，避免污染协议通信。
