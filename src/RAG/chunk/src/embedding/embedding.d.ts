/**
 *
 * @调用智谱embedding模型的API
 * input: Array<string> | string 数组长度最长64
 *
 */
export declare function createEmbeddings(inputs: Array<string> | string, dimensions: number): Promise<any>;
