import { PDFParse } from 'pdf-parse'
import { readFile, writeFile } from "fs/promises";
import { createChunks, parseMarkdown } from '../markdown/index.js';
import path from 'path'


import type { Chunk } from '../markdown/index.js'

/**
 * @解析PDF
 * 调用：pdf-parse
 * 
 * @param {*} source_path 
 * @param {*} target_path 
 * @param {*} options 
 */
export async function pdf_chunk(
    source_path: string,
    target_path: string,
    options = {
        chunkMaxLength: 120,
        chunkOverlapLength: 40// overlap 可以减少上下文被切断的问题。
    }
): Promise<Chunk[]> {
    try {
        let buffer = await readFile(source_path)
        let parser = new PDFParse({ data: buffer })
        let PDF_text = await parser.getText()
        await parser.destroy();
        let parseText = parseMarkdown(path.basename(source_path), PDF_text.text)
        const chunks = createChunks(parseText, options)
        await writeFile(target_path, JSON.stringify(chunks, null, 2))
        return chunks
    } catch (e) {
        throw new Error('文件读取或者PDF解析异常')
    }

}