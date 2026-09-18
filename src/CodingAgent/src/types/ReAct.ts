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
    fileChanges: string[];          // 修改过的文件列表
    stopReason?: StopReason;        // 停止的原因
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
    | { type: 'timeout'; durationMs: number } // 响应超时
    | { type: 'task_completed' } // 任务完成
    | { type: 'user_interrupted' } // 用户打断
    | { type: 'error'; message: string }; // 执行错误



/**
 * @结果
 */
export interface TaskVerificationResult {
    passed: boolean;
    // ...
    testResults: { passed: number; failed: number; output: string };
    typeCheckPassed: boolean;
    diffSummary: string;            // 代码变更摘要
    completionCriteriaMet: boolean; //
    details: string;                // 详细说明
}
