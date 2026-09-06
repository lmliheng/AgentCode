import path from 'path'
import { markdown_chunk } from './src/chunk/markdown/index.js'
import { pdf_chunk } from './src/chunk/pdf/index.js'

/**
 * @RAG 工具包
 * 
 * 资料读取和存储 src/file
 * 解析分块
 * 上传至Milvus
 * Milvus索引
 */
export default {
    markdown_chunk,
    pdf_chunk,

}

if (process.argv[2] === '--md') {
    await markdown_chunk(
        path.join(import.meta.dirname, 'documents/RAG.md'),
        path.join(import.meta.dirname, 'output/11.json'),
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

