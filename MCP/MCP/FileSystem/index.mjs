#!/usr/bin/env node

//ESM 模块的 shebang 也是这么写，Node 会识别

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { dirRead } from './src/Dir/dir.js';
import { disk_name } from './src/Disk/disk.js';

const server = new McpServer({
  name: 'FileSystem',
  version: '1.0.0'
});

server.registerTool(
  'list_disks',
  {
    description: '获取系统所有磁盘驱动器列表（排除A/B盘）',
    inputSchema: z.object({}),  // 使用 Zod schema
  },
  async () => {
    try {
      const disks = disk_name();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(disks, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `获取磁盘列表失败: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

server.registerTool(
  'read_directory',
  {
    description: '读取指定目录下的文件和子目录列表',
    inputSchema: z.object({  // 使用 Zod schema
      path: z.string().describe('要读取的目录路径')
    }),
  },
  async ({ path }) => {
    try {
      if (!path) {
        throw new Error('必须提供目录路径');
      }
      
      const files = await dirRead(path);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(files, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `读取目录失败: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);

console.error('MCP stdio server up');