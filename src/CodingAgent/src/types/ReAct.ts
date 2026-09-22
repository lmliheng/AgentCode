import type { ToolResult } from './Tool.js'

/**
 * @三种决策
 */
export type ModelDecision = Action | Replan | Final | BatchAction

export interface Action {
    type: 'Action';
    tool: string;           // 工具名称
    params: Record<string, unknown>; // 工具参数
    thought?: string;       // 模型的思考过程
    /**
     * 模型返回的工具调用标识，用于把工具结果与调用配对。
     * 可选：MockProvider 等不经过 Provider 边界的来源可以不带。
     */
    toolCallId?: string;
    /**
     * 参数无法解析为合法对象时的失败说明（含原始调用内容与原因）。
     * 存在时运行时 MUST 拒绝执行该动作并记录失败观察。
     */
    paramsParseError?: string;
}


export interface Replan {
    type: 'Replan';
    reason: string;         // 为什么需要重新规划
    newPlan: PlanStep[];    // 新的步骤列表
    thought?: string;
}


export interface Final {
    type: 'Final';
    answer: string;         // 最终的回答或总结
    thought?: string;
}

export interface BatchAction {
    type: 'BatchAction';
    actions: Array<{
        tool: string;
        params: Record<string, unknown>;
        thought?: string;
        /** 见 Action.toolCallId */
        toolCallId?: string;
    }>;
    thought?: string;
}

export interface PlanStep {
    id: string;             // 步骤的唯一标识
    description: string;    // 步骤描述，如 "查找用户登录接口的位置"
    status: 'pending' | 'in_progress' | 'completed' | 'failed'; // 状态
    dependsOn: string[];    // 依赖的其他步骤 ID
    completionCriteria: string; // 如何判断此步骤完成，如 "找到包含 login 的路由定义"
}

export interface PlanState {
    originalGoal: string;   // 用户的原始需求
    steps: PlanStep[];      // 所有步骤
    currentStepIndex: number; // 当前正在执行的步骤索引
    version: number;        // 计划版本号，每次 replan 递增
}

/**
 * @RuntimeState
 */
export interface AgentRunState {
    taskId: string;                 // 运行任务的唯一 ID
    plan: PlanState;                // 当前计划
    decisions: ModelDecision[];     // 所有历史决策
    observations: Observation[];    // 所有历史观察
    toolCallCount: number;          // 工具调用总次数
    iterationCount: number;         // 思考-行动循环次数
    startTime: number;              // 开始时间戳
    fileChanges: FileChange[];      // 变更过的文件
    tokenUsage: TokenUsageRecord;   // 累计 token 用量
    contextSize: ContextSizeMetric; // 当前上下文大小
    stopReason?: StopReason;        // 停止的原因
}


/**
 * 一次文件变更记录。
 *
 * 只保留可供人判断的最小信息：哪个工具动了哪个文件。具体参数留在对应决策里。
 */
export interface FileChange {
    tool: string;
    path: string;
    at: number;
}


/**
 * 累计 token 用量。
 *
 * 只承载「累计消耗」这一口径：它是各轮用量之和，用于成本统计。
 * 「当前上下文大小」是另一个语义不同的口径，不在本结构内（见 design.md D8）。
 */
export interface TokenUsageRecord {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /**
     * 命中前缀缓存的输入 token 累计。
     *
     * `null` 表示至今没有任何一轮的响应提供过这个数 —— 与「累计为 0」不同：
     * 前者是拿不到，后者是确实一次都没命中。
     */
    cacheHitTokens: number | null;
    /** 未命中前缀缓存的输入 token 累计。`null` 的含义同上 */
    cacheMissTokens: number | null;
    /**
     * 每一轮的响应是否都提供了缓存命中量。
     * false 表示上面两个值偏低而非准确 —— 缺失的轮次不计入而不是补 0。
     */
    cacheComplete: boolean;
    /**
     * 每一轮模型响应是否都返回了用量。
     * false 表示累计值不完整 —— 缺失的轮次不计入而不是补 0。
     */
    complete: boolean;
}


/**
 * 度量的来源。
 *
 * 实测与估算的可信度不同，混同会让基于阈值的判断失去依据，
 * 因此每项度量都必须标明来源。
 */
export type MetricSource = 'measured' | 'estimated' | 'unknown';


/**
 * 当前上下文大小。
 *
 * 与累计消耗是两个语义不同的口径（见 design.md D6）：每轮都重发完整历史，
 * 因此「当前上下文大小」就是最近一轮请求的输入量，而累计消耗是各轮之和，
 * 二者相差数倍 —— 混成一个数字会让预算判断严重误触发。
 */
export interface ContextSizeMetric {
    /** 最近一轮请求的输入 token 数；尚未发起过模型请求时为 null */
    tokens: number | null;
    source: MetricSource;
}




export interface Observation {
    action: Action;         // 导致此观察的原始 Action
    result: ToolResult;     // 工具执行结果
    timestamp: number;      // 记录时间戳
}


/**
 * @停止原因
 */
export type StopReason =
    | { type: 'max_iterations'; limit: number } // 最大迭代
    | { type: 'max_tool_calls'; limit: number } // 工具调用次数
    | { type: 'max_file_changes'; limit: number } // 文件变更数量
    | { type: 'timeout'; durationMs: number } // 响应超时
    | { type: 'task_completed' } // 任务完成
    | { type: 'user_interrupted' } // 用户打断
    | { type: 'error'; message: string }; // 执行错误



/**
 * @结果
 *
 * 验收结论由运行时自行产出，不取自模型自述（见 task-verification spec）。
 */
export interface TaskVerificationResult {
    /** 验收是否通过。verificationStatus 为 unavailable 时恒为 false（不可判定不等于通过） */
    passed: boolean;
    /** executed = 实际执行了验证手段；unavailable = 工作区没有可用的验证手段 */
    verificationStatus: 'executed' | 'unavailable';
    testResults: { passed: number; failed: number; output: string };
    /** null 表示未执行类型检查（工作区没有类型检查配置），不等于失败 */
    typeCheckPassed: boolean | null;
    typeCheckOutput: string;
    diffSummary: string;            // 代码变更摘要
    completionCriteriaMet: boolean; // 运行以「完成」结束且验收通过
    details: string;                // 详细说明，含实际执行的命令与结论
}
