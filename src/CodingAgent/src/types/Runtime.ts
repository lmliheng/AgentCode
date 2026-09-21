import type { PendingAction, ApprovalDecision, ApprovalPolicy } from './Tool.js'
import type { OutputBudget } from '../output-budget.js'

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
    maxConcurrency?: number;      // 最大并行数，默认 3

    /**
     * 人工审批回调。
     *
     * 提供时，需要审批的工具 MUST 由它拿到决定（见 human-approval spec）——
     * 运行时不得在这一路径上替代人工判断。未提供时按 approvalPolicy 处理。
     */
    requestApproval?: (action: PendingAction) => Promise<ApprovalDecision>;

    /**
     * 没有交互层时使用的审批策略，默认 'auto-approve'（脚本 / 测试场景）。
     * 只有未提供 requestApproval 时才生效；首次按策略放行时会输出告警。
     */
    approvalPolicy?: ApprovalPolicy;

    /** 验收命令的单条执行超时（毫秒），默认 120000 */
    verificationTimeoutMs?: number;

    /**
     * 单次工具输出的体量上限（字符与行数）。
     *
     * 提供时作为全局默认；工具自身声明的预算仍然优先于它。
     * 未提供时使用推导默认值，见 `AgentRuntime.getContextBudget()`。
     */
    outputBudget?: OutputBudget;

    /**
     * 上下文大小的 token 阈值。
     *
     * 本 change 只把判据暴露出来，不据此改变运行行为（见 design.md D7）。
     * 未提供时使用推导默认值，见 `AgentRuntime.getContextBudget()`。
     */
    contextTokenBudget?: number;
}
