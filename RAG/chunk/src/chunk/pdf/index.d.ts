import type { Chunk } from '../markdown/index.js';
/**
 * @解析PDF
 * 调用：pdf-parse
 *
 * @param {*} source_path
 * @param {*} target_path
 * @param {*} options
 */
export declare function pdf_chunk(source_path: string, target_path: string, options?: {
    chunkMaxLength: number;
    chunkOverlapLength: number;
}): Promise<Chunk[]>;
