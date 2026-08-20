import { PDFParse } from 'pdf-parse'
import { readFile, writeFile, appendFile } from "fs/promises";
import { createChunks, parseMarkdown } from '../markdown/index.js';
import path from 'path'


/**
 * @解析PDF
 * 调用：pdf-parse
 * 
 * @param {*} source_path 
 * @param {*} target_path 
 * @param {*} options 
 */
export async function pdf_chunk(
    source_path,
    target_path,
    options = {
        chunkMaxLength: 120,
        chunkOverlapLength: 40// overlap 可以减少上下文被切断的问题。
    }
) {

    try {
        let buffer = await readFile(source_path)
        let parser = new PDFParse({ data: buffer })
        let PDF_text = await parser.getText()
        let PDF_meta = await parser.getInfo({ parsePageInfo: true })
        await parser.destroy();
        let parseText = parseMarkdown({
            fileName: path.basename(source_path),
            rawText: PDF_text.text
        })
        let chunk = createChunks(parseText, options)
        await appendFile(target_path, '')
        await writeFile(target_path, JSON.stringify(chunk, null, 2))
    } catch (e) {
        console.log(e)
    }

}