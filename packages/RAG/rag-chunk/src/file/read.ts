/**
 * @路径读取
 * 
 */

import * as fs from 'fs';
import * as path from 'path';


interface MDResult {
  fileName: string;
  content: string;
}

/**
 * @递归读取data目录下所有md文件
 * 
 * 需要加内存监控逻辑，不然data下过多文件导致内存溢出
 * dataDir是绝对路径
 */
export async function readAllMDFiles(dataDir: string): Promise<MDResult[]> {
  const results: MDResult[] = [];

  // 检查目录是否存在
  if (!fs.existsSync(dataDir)) {
    console.warn(`目录 ${dataDir} 不存在`);
    return results;
  }

  /**
   * 递归遍历目录
   */
  async function traverseDirectory(dirPath: string): Promise<void> {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // 递归处理子目录
          await traverseDirectory(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          // 读取md文件内容
          try {
            const content = await fs.promises.readFile(fullPath, 'utf-8');
            // 使用相对路径作为文件名标识
            const relativePath = path.relative(dataDir, fullPath);
            
            results.push({
              fileName: relativePath,
              content: content
            });
            
            console.log(`已读取: ${relativePath}`);
          } catch (err) {
            console.error(` 读取文件失败 ${fullPath}:`, err);
          }
        }
      }
    } catch (err) {
      console.error(` 遍历目录失败 ${dirPath}:`, err);
    }
  }

  await traverseDirectory(dataDir);
  console.log(`\n共找到 ${results.length} 个md文件`);
  
  return results;
}


/**
 * @唤起文件管理器
 * 
 */