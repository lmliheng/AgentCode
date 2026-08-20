import path from 'path'
import { markdown_chunk } from './src/markdown/index.js'
import { pdf_chunk } from './src/pdf/index.js'

/**
 * @资料读取解析分块存储
 * 
 */
export default {
    markdown_chunk,
    pdf_chunk,

}

if (process.argv[2] === '--md') {
    await markdown_chunk(
        path.join(import.meta.dirname, 'documents/FileSystemMCP-design.md'),
        path.join(import.meta.dirname, 'output/8.json'),
        {
            chunkMaxLength: 100,
            chunkOverlapLength: 40
        }
    )
}

if (process.argv[2] === '--pdf') {
    await pdf_chunk(
        path.join(import.meta.dirname, 'documents/resume.pdf'),
        path.join(import.meta.dirname, 'output/4.json'),
        {
            chunkMaxLength: 150,
            chunkOverlapLength: 40
        }
    )

}

