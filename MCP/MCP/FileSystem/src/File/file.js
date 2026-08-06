
/**
 * @size换算
 */
export function formatSize(bytes) {
    if (bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const k = 1024
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + units[i]
}


/**
 * @获取文件信息
 * name
 * 大小
 */
export function FileInfo(path) {
    let name
    let size
    let CreateTime
    let EditTime
    return {
        name,
        size,
        CreateTime,
        EditTime
    }
}


/**
 * @判断文件是二进制文件还是文本文件
 */







