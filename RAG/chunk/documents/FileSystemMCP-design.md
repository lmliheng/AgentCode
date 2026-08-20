# fs mcp

category: agent mcp
owner: liheng
version: 2026-08-20

@lmliheng/filesystem-mcp 定位为面向 AI 客户端的本地文件系统 MCP 服务，当前已完成基础闭环：基于允许目录白名单做路径校验与软链防护，提供读、写、编辑（diff 预览）、目录树、glob 搜索、元数据查询等工具，stdio 通信、零外部依赖，可接入 Claude/Cursor/Copilot 等客户端，属于"能跑、能用"的社区级参考实现。

进展评价：核心安全模型（目录边界+realpath 解析）对齐官方思路，工具集覆盖日常coding场景，但相较成熟方案仍缺三块——批量多路径操作与逐条状态回报、只读/读写分级权限、大文件流式与 .gitignore 感知，测试与版本节奏也偏早期。

后续更新思路：短期补 Zod 参数校验、批量 tool、edit 返回 unified diff、单元测试与 smoke 测试；中期加 --readonly 模式、MCP Roots 动态根、POSIX chmod/chown、正则多文件替换、尊重 gitignore；长期可做 SSE/HTTP 传输、Docker 只读挂载示例、操作审计日志、WebDAV/对象存储适配。差异化建议是走"安全可审计的轻量层"而非堆功能，配套中文 README 与 Claude/Cursor 配置片段更易获采用。