
/**
 * @Runtime配置
 * agent runtime 是agent的运行环境，整体约束Agent的行为
 */
export interface AgentRuntimeConfig {
    maxIterations: number;        // 最大思考-行动循环次数
    maxToolCalls: number;         // 最大工具调用次数
    timeoutMs: number;            // 超时时间（毫秒）
    maxFileChanges: number;       // 最大文件修改数量
    workspacePath: string;        // 代码工作区路径
    maxConcurrency?: number;  // 新增：最大并行数，默认 3
    
}