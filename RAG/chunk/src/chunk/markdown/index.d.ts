/**
 * @数据定义
 */
export interface Chunk {
    embedding?: Array<number> | undefined;
    chunkId: string;
    content: string;
    metadata: {
        source: string;
        title: string;
        category: string;
        owner: string;
        sourceVersion: string;
        chunkIndex: number;
        contentHash: string;
        chunkLength: number;
    };
}
interface ParseResult {
    fileName: string;
    title: string;
    category: string;
    owner: string;
    sourceVersion: string;
    text: string;
}
interface chunk_option {
    chunkMaxLength: number;
    chunkOverlapLength: number;
}
/**
 *
 * @param {*} source_path md文件的绝对路径
 * @param {*} target_path json文件的绝对路径
 * @param {*}  options = {
 *                  chunkMaxLength: 120,
 *                  chunkOverlapLength: 40// overlap 可以减少上下文被切断的问题。
 *                  }
 */
export declare function markdown_chunk(fileName: string, content: string, options?: chunk_option): Chunk[];
/**
 * 解析 Markdown 文档。
 *
 * 这一步会从原始 Markdown 中提取：
 * - 文件名
 * - 标题
 * - category
 * - owner
 * - version
 * - 正文内容
 */
export declare function parseMarkdown(fileName: string, rawText: string): ParseResult;
/**
 * 处理超长段落。
 *
 * 如果某个段落本身已经超过 chunkMaxLength，
 * 就只能按照固定长度继续切成多个小片段。
 */
export declare function splitLongParagraph(paragraph: string, options: chunk_option): string[];
/**
 * 把一份文档切成多个 Chunk。
 *
 * 整体流程：
 * 1. 先把正文拆成段落
 * 2. 尽量把多个段落合并成一个 Chunk
 * 3. 如果超过最大长度，就结束当前 Chunk
 * 4. 新 Chunk 开头带上一点 overlap
 * 5. 最后为每个 Chunk 补充 metadata
 */
export declare function createChunks(document: ParseResult, options: chunk_option): Chunk[];
export {};
