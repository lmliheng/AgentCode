#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import 'console';
import { execSync } from 'child_process';

/**
 * @size换算
 */
function formatSize(bytes) {
    if (bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + units[i]
}


/**
 * @判断文件是二进制文件还是文本文件
 */

/**
 * @列出目录下目录名和文件名
 */
async function dirRead(dirPath) {
    let res = [];
    let items = await readdir(dirPath);
    for (const item of items) {
        try {
            let item_path = path.join(dirPath, item);
            let item_stat = await stat(item_path);
            if (item_stat.isFile()) {
                res.push({
                    name: item,
                    size: formatSize(item_stat.size),
                    type: 'file'
                });
            } else if (item_stat.isDirectory()) {
                res.push({
                    name: item,
                    size: formatSize(item_stat.size),
                    type: 'dir'
                });
            }
        } catch (error) {
            // 跳过无法读取的文件（如系统临时文件）
            console.warn(`跳过文件 ${item}: ${error.message}`);
            continue
        }
        
    }
    return res
}

/**
 * @列出磁盘名称数组
 * 使用windows命令获取到结果
 */
function disk_name() {
    const result = execSync('wmic logicaldisk get caption').toString();
    const drives = result.trim()
        .split('\n')
        .slice(1)
        .filter(Boolean)
        .map(d => d.trim())
        .filter(d => !['A:', 'B:'].includes(d));
    return drives
}

if (process.argv[2] === '--server') {
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
}
var index = {
  dirRead, disk_name
};

export { index as default };
