// src/test/setup.ts

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, dirname, sep } from 'path';
import { tmpdir } from 'os';

/**
 * 创建测试工作区
 * @param files 文件映射表 { 'path/to/file.ts': 'content' }
 * @returns 工作区根目录路径
 */
export function createTestWorkspace(files: Record<string, string>): string {
    // 创建临时目录
    const dir = mkdtempSync(join(tmpdir(), 'coding-agent-test-'));
    
    // 创建文件
    for (const [relativePath, content] of Object.entries(files)) {
        const fullPath = join(dir, relativePath);
        const parentDir = dirname(fullPath);
        
        // 确保父目录存在
        if (!existsSync(parentDir)) {
            mkdirSync(parentDir, { recursive: true });
        }
        
        // 写入文件
        writeFileSync(fullPath, content, 'utf-8');
    }
    
    return dir;
}

/**
 * 清理测试工作区
 */
export function cleanupTestWorkspace(dir: string): void {
    if (dir && existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
    }
}