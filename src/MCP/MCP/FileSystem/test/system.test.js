import { describe, it } from 'node:test'
import { strictEqual } from 'assert'
import { disk_name } from '../src/Disk/disk.js'
import { dirRead } from '../src/Dir/dir.js'


describe('磁盘和目录', () => {
    it('查询磁盘列表', () => {
        let res = disk_name()
        strictEqual(res instanceof Object, true)
    }),
        it('读取目录下目录和文件', async () => {
            let res = await dirRead('C:\\')
            strictEqual(res instanceof Object, true)
        })
})