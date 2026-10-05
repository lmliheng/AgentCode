#!/usr/bin/env node
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { register as registerLogin } from './tools/login.js';
import { register as registerLogout } from './tools/logout.js';
import { register as registerInit } from './tools/init.js';
import { register as registerEnv } from './tools/env.js';
import { register as registerService } from './tools/service.js';
import { register as registerRun } from './tools/run.js';
import { register as registerFunction } from './tools/function.js';
import { register as registerStorage } from './tools/storage.js';
import { register as registerVersion } from './tools/version.js';
import { register as registerHealth } from './tools/health.js';
import { register as registerResources } from './resources/index.js';
import { register as registerPrompts } from './prompts/index.js';
// ---------------------------------------------------------------------------
// 创建 Server
// ---------------------------------------------------------------------------
function createServer() {
    const server = new McpServer({
        name: 'wxcloud-mcp',
        title: '微信云托管 MCP',
        version: '1.0.0',
        description: '微信云托管 MCP Server，基于 wxcloud CLI，提供环境、服务、部署、云函数、对象存储等能力',
    }, {
        capabilities: {
            tools: { listChanged: true },
            resources: { listChanged: true },
            prompts: { listChanged: true },
        },
    });
    // 注册工具
    registerLogin(server);
    registerLogout(server);
    registerInit(server);
    registerEnv(server);
    registerService(server);
    registerRun(server);
    registerFunction(server);
    registerStorage(server);
    registerVersion(server);
    registerHealth(server);
    // 注册资源
    registerResources(server, ResourceTemplate);
    // 注册提示模板
    registerPrompts(server);
    return server;
}
// ---------------------------------------------------------------------------
// 启动 stdio server
// ---------------------------------------------------------------------------
void serveStdio(createServer);
console.error('wxcloud MCP server 运行中 (stdio)');
