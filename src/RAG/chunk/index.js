import path from 'path';
import { readFile, writeFile } from 'node:fs/promises';
import { markdown_chunk } from './src/chunk/markdown/index.js';
import { pdf_chunk } from './src/chunk/pdf/index.js';
import { createServer } from './src/server/index.js';
/**
 * @RAG 工具包
 *
 * 资料读取和存储 src/file
 * 解析分块
 * 生成向量
 * 上传chunk json ， milvus检索
 *
 * web服务
 */
// allowedOrigins 优先从环境变量读取，多个用逗号分隔
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : ['http://127.0.0.1:80'];
createServer({ secret: 'lmliheng', allowedOrigins }).listen(3000, () => console.log('服务运行'));
if (process.argv[2] === '--md') {
    const sourcePath = path.join(import.meta.dirname, 'documents/RAG.md');
    const targetPath = path.join(import.meta.dirname, 'output/11.json');
    const content = await readFile(sourcePath, 'utf-8');
    const chunks = markdown_chunk(path.basename(sourcePath), content, {
        chunkMaxLength: 100,
        chunkOverlapLength: 40
    });
    await writeFile(targetPath, JSON.stringify(chunks, null, 2));
    console.log(`分块完成，已写入 ${targetPath}`);
}
if (process.argv[2] === '--pdf') {
    const sourcePath = path.join(import.meta.dirname, 'documents/resume.pdf');
    const targetPath = path.join(import.meta.dirname, 'output/4.json');
    const chunks = await pdf_chunk(sourcePath, targetPath, {
        chunkMaxLength: 150,
        chunkOverlapLength: 40
    });
    // 如果 pdf_chunk 内部未写入，在此处写入
    if (chunks.length > 0) {
        await writeFile(targetPath, JSON.stringify(chunks, null, 2));
    }
    console.log(`PDF 分块完成，共 ${chunks.length} 个块`);
}
