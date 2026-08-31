/**
 * @获取目录信息
 * 用处不大
 */
export declare function Dir_info(path: any): Promise<import("node:fs").Stats>;
/**
 * @列出目录下目录名和文件名
 */
export declare function dirRead(dirPath: any): Promise<{
    name: string;
    size: string;
    type: string;
}[]>;
