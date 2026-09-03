/**
 * @tools/fs_tools.js
 * 文件系统工具集（MVP 最小集）：
 *   read_file / write_file / list_dir
 *
 * 安全边界：所有工具以工作目录 root 为根，路径越界直接拒绝。
 * 工具用 @langchain/core 的 tool() 封装 + zod 参数校验，
 * 模型通过 bind_tools 看到它们。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * 创建绑定到指定工作目录的工具集
 * @param {string} rootDir 工作目录（绝对路径）
 */
export function createFsTools(rootDir) {
  const root = path.resolve(rootDir);

  /** 校验并解析工作目录内的安全路径，越界抛错 */
  function safePath(p) {
    const resolved = path.resolve(root, p);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error(`路径越界：${p} 不在工作目录 ${root} 内`);
    }
    return resolved;
  }

  const readFile = tool(
    async ({ path: p }) => {
      try {
        const fp = safePath(p);
        const stat = await fs.stat(fp);
        if (stat.isDirectory()) {
          const entries = await fs.readdir(fp, { withFileTypes: true });
          return JSON.stringify(
            entries.map((e) => ({
              name: e.name,
              type: e.isDirectory() ? "dir" : "file",
            })),
            null,
            2
          );
        }
        return await fs.readFile(fp, "utf-8");
      } catch (e) {
        return `读取失败：${e.message}`;
      }
    },
    {
      name: "read_file",
      description:
        "读取工作目录内的文件内容（UTF-8 文本）；若传入的是目录路径，则返回该目录下的条目列表（名称+类型）。路径必须是相对工作目录的路径。",
      schema: z.object({
        path: z.string().describe("相对工作目录的文件或目录路径"),
      }),
    }
  );

  const writeFile = tool(
    async ({ path: p, content }) => {
      try {
        const fp = safePath(p);
        await fs.mkdir(path.dirname(fp), { recursive: true });
        await fs.writeFile(fp, content, "utf-8");
        return `已写入 ${p}（${content.length} 字符）`;
      } catch (e) {
        return `写入失败：${e.message}`;
      }
    },
    {
      name: "write_file",
      description:
        "写入或覆盖工作目录内的一个文件（UTF-8 文本）。父目录不存在会自动创建。路径必须是相对工作目录的路径。",
      schema: z.object({
        path: z.string().describe("相对工作目录的目标文件路径"),
        content: z.string().describe("要写入的完整文件内容"),
      }),
    }
  );

  const listDir = tool(
    async ({ path: p }) => {
      try {
        const fp = safePath(p);
        const entries = await fs.readdir(fp, { withFileTypes: true });
        return JSON.stringify(
          entries.map((e) => ({
            name: e.name,
            type: e.isDirectory() ? "dir" : "file",
          })),
          null,
          2
        );
      } catch (e) {
        return `列出目录失败：${e.message}`;
      }
    },
    {
      name: "list_dir",
      description:
        "列出工作目录内某个目录下的条目（名称+类型）。路径必须是相对工作目录的路径。",
      schema: z.object({
        path: z.string().describe("相对工作目录的目录路径"),
      }),
    }
  );

  return [readFile, writeFile, listDir];
}
