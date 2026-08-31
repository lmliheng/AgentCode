import path from "node:path"


/**
 * @size换算
 */
export function formatSize(bytes: number) {
    if (bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const k = 1024
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + units[i]
}


/**
 * @获取文件信息
 * name,size...
 */
export function FileInfo() {

}


/**
 * @判断文件是二进制文件还是文本文件
 */







