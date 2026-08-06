
import { execSync } from 'child_process'

/**
 * @列出磁盘名称数组
 * 使用windows命令获取到结果
 */
export function disk_name() {
    const result = execSync('wmic logicaldisk get caption').toString();
    const drives = result.trim()
        .split('\n')
        .slice(1)
        .filter(Boolean)
        .map(d => d.trim())
        .filter(d => !['A:', 'B:'].includes(d));
    return drives
}






