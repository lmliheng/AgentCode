import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { createServer } from './server.js';
import * as z from 'zod/v4';
const handler = createMcpHandler(() => {
    return createServer();
});
const app = createMcpExpressApp();
const node = toNodeHandler(handler);
app.all('/mcp', (req, res) => void node(req, res, req.body));
app.listen(3000, () => {
    console.log('MCP server on http://127.0.0.1:3000/mcp');
});
