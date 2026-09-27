// src/mcp/index.ts —— MCP（Model Context Protocol）stdio 客户端
//
// 对外只需要三个入口：
//   - loadMcpConfig / mcpConfigFile：读 `<工作区>/.acode/mcp.json`
//   - connectMcpServers：连上一批 server，拿到可以直接并进工具数组的工具
//   - McpClient / McpTool / 命名与渲染工具：需要自己装配或写测试时用
export * from './protocol.js';
export * from './config.js';
export * from './client.js';
export * from './tool.js';
export * from './connect.js';
