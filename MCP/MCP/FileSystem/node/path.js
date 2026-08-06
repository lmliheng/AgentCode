import * as path from 'path'



/**
 * @EM里的__dirname和filename获取
 */
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename)

/**
 * @path
 */
let hostjs_path = path.join(__dirname, '../../高德/host.js')


if (process.argv[2] === '--test') {
    console.log(__filename)
    console.log(__dirname)
    console.log(hostjs_path)
}

export {
    hostjs_path
}
