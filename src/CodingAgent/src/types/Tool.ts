// src/types/Tool.ts

import type { OutputBudget } from '../output-budget.js';



/**
 * 工具的统一抽象接口
 *
 * 所有工具（读文件、写文件、运行测试等）都需要实现此接口
 *
 * 感知|变更|验证|控制 类工具
 */
export interface Tool<T extends ToolParams = ToolParams> {
    /** 工具名称，全局唯一 */
    readonly name: string;
    /** 工具描述，用于告诉模型这个工具的作用 */
    readonly description: string;
    //权限
    readonly permissions: ToolPermissions;
    //是否常驻  shouldDefer / alwaysLoad
    // readonly deferred:boolean; 靠常驻白名单就行
    /**
     * 可选的输出预算声明。
     *
     * 声明后该工具的输出按自身预算处理；未声明则由运行时以全局默认兜底
     * （见 src/output-budget.ts 与 design.md D5）。两个维度同时生效。
     */
    readonly outputBudget?: OutputBudget;
    //参数校验
    validate(params: unknown): ValidationResult
    /**
     * 执行工具
     * @param params 经过校验的工具参数类型
     * @param ctx 工具携带信息
     */
    execute(params: T, ctx: ToolContext): Promise<ToolResult>;
    /**
     * 获取工具的 JSON Schema，用于模型调用时的参数验证
     */
    getSchema(): Record<string, unknown>;


}



// 
// interface Tool_ {
//   name: string
//   description: string
//   inputSchema: JSONSchema
//   risk: 'low' | 'medium' | 'high'
//   execute(params): Promise<ToolResult>
// }



/**
 * 工具执行的结果
 */
export interface ToolResult {
    success: boolean;
    data: unknown;
    error?: string;
    /**
     * 这次执行做了什么的一句话人读摘要，例如「src/cli.ts 第 12–45 行 / 共 320 行」。
     *
     * 由**工具自己**产出，理由有两个：
     *   1. 有些事实只有工具算得出来。`read_directory` 的 `data.total` 是顶层条目数、
     *      也没有截断标志，要报「这个目录下多少个文件」必须它自己在遍历时计数。
     *   2. 措辞与实参的知识属于工具，不属于调用方；放在这里，新增工具不会因为
     *      调用方的 switch 少一个分支而退化成「执行 xxx」。
     *
     * **只给人看，不进模型上下文。** 运行时构造工具结果消息时走的是显式字段装配
     * （见 `AgentRuntime.toToolResultMessage`），本字段不在其中 —— 这正是它与
     * `data` 分开的原因：`data` 是给模型的，`display` 是给人的。
     *
     * 省略是合法且有意义的：解释不了自己的执行（或还没写）的工具就省略，
     * 调用方退回只显示工具名，而不是显示一句空话。
     */
    display?: string;
}


/**
 * 工具权限声明
 */
export interface ToolPermissions {
    readsFiles: boolean;
    writesFiles: boolean;
    runsShell: boolean;
    requiresApproval: boolean;
}

/**
 * 工具参数的基类
 * 
 * 每个工具定义自己的参数类型，继承此接口
 */
export interface ToolParams {
    /** 参数版本号，用于向后兼容 */
    _version?: number;
}


/**
 * 参数校验结果
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];       // 校验失败时的错误信息
    sanitized: unknown;     // 清洗后的参数（去除多余字段、设置默认值）
}


export interface ToolContext {
    workspaceRoot: string      // 工作区根
    allowedPaths: string[]     // 白名单
    runId: string
    signal?: AbortSignal;  // 异步长任务-取消函数
    // 用于 HITL 回调
    requestApproval(action: PendingAction): Promise<ApprovalDecision>
}


/** 人工对一次待审批操作的决定 */
export type ApprovalDecision = 'approve' | 'reject';

/**
 * 没有交互层（脚本、测试）时的审批策略。
 *
 * 注意这是显式声明的配置，而不是隐藏的默认值：运行时会在首次按策略放行时
 * 输出一次告警，使「审批没有被人工看过」这件事不会被静默吞掉。
 */
export type ApprovalPolicy = 'auto-approve' | 'auto-reject';


/**
 * 待审批的操作
 * 
 * 当模型决定执行一个敏感操作时，Runtime 不会立即执行，
 * 而是创建一个 PendingAction，等待人工确认。
 */
export interface PendingAction {
    /** 唯一标识 */
    id: string;
    /** 关联的运行 ID */
    runId: string;

    /** 操作的创建时间 */
    createdAt: number;

    /** 操作的来源：模型决策的完整记录 */
    source: {
        /** 模型当时的思考过程 */
        thought: string;
        /** 完整的 Action 决策 */
        decision: {
            type: 'Action';
            tool: string;
            params: Record<string, unknown>;
        };
        /** 当时对话上下文的快照（用于审计） */
        contextSnapshot: {
            currentPlan: string;
            recentHistory: string;
            currentStep: string;
        };
    };

    /** 操作执行前的预览信息 */
    preview: {
        /** 工具名称 */
        tool: string;
        /** 人类可读的描述 */
        summary: string;
        /** 将要影响的文件列表 */
        affectedFiles: Array<{
            path: string;
            changeType: 'create' | 'modify' | 'delete';
            /** 如果是修改，这里是 diff 预览 */
            diffPreview?: string;
        }>;
        /** 风险评估 */
        riskLevel: 'low' | 'medium' | 'high';
    };
    /** 审批状态 */
    status: 'pending' | 'approved' | 'rejected' | 'expired';
    /** 审批信息（审批后填写） */
    review?: {
        reviewer: string;        // 审批人标识
        action: 'approve' | 'reject';
        comment?: string;        // 审批意见
        reviewedAt: number;      // 审批时间
    };

    /** 超时时间（超过此时间自动拒绝） */
    expiresAt: number;
}





