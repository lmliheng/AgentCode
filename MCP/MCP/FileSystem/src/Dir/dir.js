import { stat, readdir } from 'fs/promises'
import path from 'path'
import { formatSize } from '../File/file.js'
import { dir } from 'console'

/**
 * @获取目录信息
 * 用处不大
 */
export async function Dir_info(path) {
    let stat = await stat(path)
    return stat
}


/**
 * @列出目录下目录名和文件名
 */
export async function dirRead(dirPath) {
    let res = []
    let items = await readdir(dirPath)
    for (const item of items) {
        try {
            let item_path = path.join(dirPath, item)
            let item_stat = await stat(item_path)
            if (item_stat.isFile()) {
                res.push({
                    name: item,
                    size: formatSize(item_stat.size),
                    type: 'file'
                })
            } else if (item_stat.isDirectory()) {
                res.push({
                    name: item,
                    size: formatSize(item_stat.size),
                    type: 'dir'
                })
            }
        } catch (error) {
            // 跳过无法读取的文件（如系统临时文件）
            console.warn(`跳过文件 ${item}: ${error.message}`)
            continue
        }
        
    }
    return res
}
