import { readFile } from 'fs/promises'
import { hostjs_path } from './path.js'
/**
 * @File
 */


/**
 * @readFile
 */
let code = await readFile(hostjs_path, 'utf8')
code = JSON.stringify(code)

