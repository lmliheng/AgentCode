import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentProvider, ToolDefinition, TokenUsage } from '../types/AgentProvider.js';
import { REQUEST_REPLAN_TOOL, BATCH_TOOL } from '../types/AgentProvider.js';
import type { ChatMessage, AssistantMessage, ToolMessage, ToolCall } from '../types/Message.js';

import type {
    ModelDecision,
    AgentRunState,
    PlanState,
    PlanStep,
    Observation,
    StopReason,
    TaskVerificationResult,
    FileChange,
    Action,
} from '../types/ReAct.js';

import type { AgentRuntimeConfig } from '../types/Runtime.js'
import { applyOutputBudget, resolveContextBudget, NO_OUTPUT_PLACEHOLDER } from '../output-budget.js';
import type { ContextBudgetJudgement } from '../output-budget.js';
import type {
    Tool,
    ToolParams,
    PendingAction,
    ToolContext,
    ToolResult,
    ApprovalDecision,
} from '../types/Tool.js';


interface FailureRecord {
    tool: string;
    error: string;
    timestamp: number;
}

/** 各类决策里描述「一个动作」的共同形状（Action 本体或 BatchAction 的子项） */
interface ActionLike {
    tool: string;
    params: Record<string, unknown>;
    thought?: string;
    toolCallId?: string;
}

/** 会产生文件变更的工具 */
const MODIFYING_TOOLS = ['edit_file', 'delete_file', 'create_file', 'move_file', 'apply_diff', 'git_operation'];

/**
 * 模型没有提交初始计划时使用的兜底步骤。
 *
 * 计划是推进任务的手段而不是前置条件：规划轮拿不到计划时用它保底，
 * 让循环照常开始，而不是把整个任务拦在规划阶段。
 */
const FALLBACK_PLAN_STEPS: PlanStep[] = [
    {
        id: 'step-1',
        description: '理解需求和代码结构',
        status: 'pending',
        dependsOn: [],
        completionCriteria: '已理解任务目标和相关代码',
    },
    {
        id: 'step-2',
        description: '实现代码变更',
        status: 'pending',
        dependsOn: ['step-1'],
        completionCriteria: '代码变更已完成并通过类型检查',
    },
    {
        id: 'step-3',
        description: '运行测试验证',
        status: 'pending',
        dependsOn: ['step-2'],
        completionCriteria: '所有测试通过',
    },
];

/**
 * 规划轮的提示词。
 *
 * 与循环内的系统提示分开：这一轮唯一的产品是计划，执行类工具的调用
 * 在这一轮既无人消费、也不计入预算。
 */
const PLANNING_SYSTEM_PROMPT = `你是 AI 编码助手。这一轮只做规划：把任务拆成可依次执行、可独立判断完成的步骤，不要执行任何操作。

要求：
- 通过 ${REQUEST_REPLAN_TOOL} 提交步骤列表，不要调用其他工具。
- 每个步骤的 completionCriteria 必须写清「怎么算这一步完成了」。
- 步骤之间的先后依赖用 dependsOn 标明，取值是其他步骤的 id。
- 步骤范围以任务本身为界，不要拆出与任务无关的步骤。`;

/** 一次动作执行内的审批决定缓存，使同一动作只问一次 */
interface ApprovalCache {
    decision: ApprovalDecision | null;
}


/**
 * Agent Runtime
 *
 * 核心职责：
 * 1. 管理 Agent 运行的完整生命周期
 * 2. 协调「思考→行动→观察」循环
 * 3. 检测停止条件，防止无限循环
 * 4. 管理工具调用和结果验证
 * 5. 支持 Human-in-the-Loop 确认
 *
 * 不负责「决策从哪来」——那是 Provider 的边界翻译职责（见 design.md D1）。
 * 本类只消费内部决策词汇表（Action / Replan / Final / BatchAction）。
 */
export class AgentRuntime {
    private provider: AgentProvider;
    private tools: Map<string, Tool<ToolParams>>;
    private config: AgentRuntimeConfig;
    private state!: AgentRunState;
    private pendingActions: Map<string, PendingAction> = new Map();

    private failureHistory: FailureRecord[] = [];
    private readonly MAX_RETRIES_PER_TOOL = 3;
    private readonly RETRY_WINDOW_MS = 60000; // 1分钟内同一工具失败超过3次则触发replan
    private readonly maxConcurrency: number
    /** 未配置审批回调时，只告警一次，避免自动放行被静默吞掉 */
    private approvalWarned = false;

    constructor(
        provider: AgentProvider,
        tools: Tool<ToolParams>[],
        config: Partial<AgentRuntimeConfig> = {}
    ) {
        this.provider = provider;
        this.tools = new Map(tools.map(t => [t.name, t]));
        this.config = {
            maxIterations: 50,
            maxToolCalls: 100,
            timeoutMs: 300000,        // 5分钟
            maxFileChanges: 20,
            workspacePath: '.',
            ...config,
        }
        this.maxConcurrency = config.maxConcurrency ?? 3;

    }

    /**
     * 执行一个任务
     */
    async run(taskDescription: string): Promise<{
        state: AgentRunState;
        verification?: TaskVerificationResult;
    }> {
        // 1. 初始化运行状态
        this.state = this.initializeState(taskDescription);
        this.approvalWarned = false;

        try {
            // 2. 生成初始计划
            await this.createInitialPlan(taskDescription);

            // 3. 进入主循环
            while (!this.shouldStop()) {
                // 3.1 构建上下文消息（真实消息序列）
                const messages = this.buildContextMessages();

                const toolDefinitions = this.buildToolDefinitions();

                // 3.2 让模型决策
                const response = await this.provider.decide(messages, toolDefinitions);
                const decision = response.decision;

                // 3.3 记录用量与当前上下文大小
                this.recordUsage(response.usage, messages);

                // 3.4 记录决策
                this.state.decisions.push(decision);
                this.state.iterationCount++;

                // 3.5 处理决策
                const shouldContinue = await this.processDecision(decision);

                if (!shouldContinue) {
                    break;
                }
            }

            // 4. 执行验收
            const verification = await this.verifyTask();

            return {
                state: this.state,
                verification,
            };

        } catch (error) {
            // 发生未预期的错误时，记录并停止
            this.state.stopReason = {
                type: 'error',
                message: (error as Error).message,
            };

            return {
                state: this.state,
            };
        }
    }

    /**
     * 初始化运行状态
     */
    private initializeState(taskDescription: string): AgentRunState {
        return {
            taskId: crypto.randomUUID(),
            plan: {
                originalGoal: taskDescription,
                steps: [],
                currentStepIndex: 0,
                version: 1,
            },
            decisions: [],
            observations: [],
            toolCallCount: 0,
            iterationCount: 0,
            startTime: Date.now(),
            fileChanges: [],
            tokenUsage: {
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                complete: true,
            },
            // 尚未发起模型请求，当前上下文大小未知（不是 0）
            contextSize: {
                tokens: null,
                source: 'unknown',
            },
        };
    }

    /**
     * 记录一轮请求的用量与上下文大小。
     *
     * 两个口径分开存放（见 design.md D6）：
     *   - 累计消耗：各轮用量之和，随轮次单调不减，用于成本统计
     *   - 当前上下文大小：最近一轮的输入量，用于预算判断
     *
     * 累计用量缺失时不补 0，而是把累计值标记为不完整。
     * 当前上下文大小优先取模型响应的真实输入量；缺失时按字符数粗略推算，
     * 并明确标注为「估算」—— 实测与估算的可信度不同，不得混同。
     */
    private recordUsage(usage: TokenUsage | undefined, messages: ChatMessage[]): void {
        const measuredPrompt = usage?.promptTokens;

        if (usage) {
            this.state.tokenUsage.promptTokens += usage.promptTokens;
            this.state.tokenUsage.completionTokens += usage.completionTokens;
            this.state.tokenUsage.totalTokens += usage.totalTokens;
        } else {
            this.state.tokenUsage.complete = false;
        }

        if (typeof measuredPrompt === 'number' && measuredPrompt > 0) {
            this.state.contextSize = { tokens: measuredPrompt, source: 'measured' };
            return;
        }

        const chars = messages.reduce((sum, message) => sum + messageCharCount(message), 0);
        this.state.contextSize = { tokens: estimateTokensFromChars(chars), source: 'estimated' };
    }

    /**
     * 当前生效的预算判据：外部配置优先，未配置时使用推导默认值。
     *
     * 本 change 只暴露判据，不据此改变运行行为（见 design.md D7）。
     */
    getContextBudget(): ContextBudgetJudgement {
        return resolveContextBudget({
            ...(this.config.outputBudget !== undefined ? { outputBudget: this.config.outputBudget } : {}),
            ...(this.config.contextTokenBudget !== undefined ? { contextTokenBudget: this.config.contextTokenBudget } : {}),
        });
    }

    /**
     * 生成初始计划
     *
     * 规划是进入循环前的独立一轮模型调用：运行时下发已注册的工具声明，
     * 要求模型通过 `request_replan` 提交步骤列表 —— 这是协议里唯一能携带
     * 结构化计划的通道（见 design.md D1，决策从哪来由 Provider 翻译）。
     *
     * 本轮只取计划：不执行工具、不计入迭代与工具调用预算，但用量照常计入
     * 累计消耗（它同样是一次真实的模型调用）。
     *
     * 模型没按协议提交计划、或这一轮调用失败时回落到兜底计划，
     * 让循环照常开始，而不是把整个任务拦在规划阶段。
     */
    private async createInitialPlan(taskDescription: string): Promise<void> {
        const toolDefinitions = this.buildToolDefinitions();

        // 没有可执行工具时控制流入口不会被声明，模型也就没有提交计划的通道，
        // 这一轮请求注定拿不到计划 —— 直接跳过，不做无谓的调用。
        if (toolDefinitions.length === 0) {
            this.state.plan.steps = cloneFallbackPlan();
            return;
        }

        const messages: ChatMessage[] = [
            { role: 'system', content: PLANNING_SYSTEM_PROMPT },
            {
                role: 'user',
                content: `任务目标: ${taskDescription}\n\n请先给出执行计划：调用 ${REQUEST_REPLAN_TOOL} 提交步骤列表。`,
            },
        ];

        let steps: PlanStep[] = [];

        try {
            const response = await this.provider.decide(messages, toolDefinitions);
            this.recordUsage(response.usage, messages);

            if (response.decision.type === 'Replan') {
                steps = normalizePlanSteps(response.decision.newPlan);
            }
        } catch (error) {
            console.warn(`[AgentRuntime] 初始计划生成失败，改用兜底计划: ${(error as Error).message}`);
        }

        if (steps.length === 0) {
            console.warn(
                `[AgentRuntime] 模型未通过 ${REQUEST_REPLAN_TOOL} 提交初始计划，改用兜底计划`
            );
            steps = cloneFallbackPlan();
        }

        this.state.plan.steps = steps;
    }

    /**
     * 生成随请求下发的工具声明。
     */
    private buildToolDefinitions(): ToolDefinition[] {
        return Array.from(this.tools.values()).map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.getSchema() as Record<string, unknown>,
        }));
    }



    /**
     * 判断是否应该停止
     */
    private shouldStop(): boolean {
        // 1. 检查是否已有停止原因
        if (this.state.stopReason) {
            return true;
        }

        // 2. 检查最大迭代次数
        if (this.state.iterationCount >= this.config.maxIterations) {
            this.state.stopReason = {
                type: 'max_iterations',
                limit: this.config.maxIterations,
            };
            return true;
        }

        // 3. 检查最大工具调用次数
        if (this.state.toolCallCount >= this.config.maxToolCalls) {
            this.state.stopReason = {
                type: 'max_tool_calls',
                limit: this.config.maxToolCalls,
            };
            return true;
        }

        // 4. 检查超时
        const elapsed = Date.now() - this.state.startTime;
        if (elapsed >= this.config.timeoutMs) {
            this.state.stopReason = {
                type: 'timeout',
                durationMs: elapsed,
            };
            return true;
        }

        // 5. 检查文件变更数量
        if (this.state.fileChanges.length >= this.config.maxFileChanges) {
            this.state.stopReason = {
                type: 'max_iterations', // 复用此类型表示文件变更过多
                limit: this.config.maxFileChanges,
            };
            return true;
        }

        // 6. 检查重复 Action（连续 3 次相同的 Action）
        if (this.hasRepeatedActions()) {
            this.state.stopReason = {
                type: 'error',
                message: '检测到重复的 Action，可能陷入循环',
            };
            return true;
        }
        return false;
    }




    /**
     * 检测是否存在重复的 Action
     */
    private hasRepeatedActions(): boolean {
        const recentDecisions = this.state.decisions.slice(-3);
        if (recentDecisions.length < 3) return false;

        // 只有连续 3 次完全相同的 Action（tool + params 都相同）才判定为循环
        return recentDecisions.every(d => {
            if (d.type !== 'Action') return false;
            const first = recentDecisions[0] as ModelDecision & { type: 'Action' };
            const current = d as ModelDecision & { type: 'Action' };
            return (
                current.tool === first.tool &&
                JSON.stringify(current.params) === JSON.stringify(first.params)
            );
        });
    }



    /**
     * 处理模型决策
     *
     * @returns false 表示应该停止循环
     */
    private async processDecision(decision: ModelDecision): Promise<boolean> {
        switch (decision.type) {
            case 'Action':
                return this.executeAction(decision);
            case 'Replan':
                return this.handleReplan(decision);
            case 'Final':
                this.state.stopReason = { type: 'task_completed' };
                return false;
            case 'BatchAction':
                return this.executeBatchActions(decision);
            default:
                this.state.stopReason = {
                    type: 'error',
                    message: `未知的决策类型: ${(decision as any).type}`,
                };
                return false;
        }
    }
    private async executeBatchActions(batch: ModelDecision & { type: 'BatchAction' }): Promise<boolean> {
        const tasks = batch.actions.map((subAction) => {
            const decision: Action = {
                type: 'Action',
                tool: subAction.tool,
                params: subAction.params,
                thought: subAction.thought || '',
                ...(subAction.toolCallId !== undefined ? { toolCallId: subAction.toolCallId } : {}),
            };
            return () => this.executeAction(decision);
        });

        const results: boolean[] = [];

        // 并发控制：每次最多跑 maxConcurrency 个
        const queue = [...tasks];
        const running: Promise<boolean>[] = [];

        while (queue.length > 0 || running.length > 0) {
            // 填满并发槽位
            while (running.length < this.maxConcurrency && queue.length > 0) {
                const task = queue.shift()!;
                const promise = task().then((shouldContinue) => {
                    results.push(shouldContinue);
                    return shouldContinue;
                });
                running.push(promise);
                // promise 完成后从 running 中移除
                promise.finally(() => {
                    const idx = running.indexOf(promise);
                    if (idx > -1) running.splice(idx, 1);
                });
            }

            // 等待任意一个完成
            if (running.length > 0) {
                await Promise.race(running);
            }
        }

        // 检查是否所有任务都允许继续
        return results.every(Boolean);
    }

    /**
     * 执行一个 Action（工具调用）
     *
     * 不抛错：一切「不能执行」的情形都转成失败观察，让循环继续、模型有机会修正。
     */
    private async executeAction(action: Action): Promise<boolean> {
        // 1. 检查工具调用次数
        if (this.state.toolCallCount >= this.config.maxToolCalls) {
            return false;
        }

        // 2. 参数无法解析：拒绝执行并留下原始内容与原因
        if (action.paramsParseError) {
            this.pushFailureObservation(action, action.paramsParseError);
            return true;
        }

        // 3. 查找工具（未知工具同样只记为失败观察，不中断整个运行）
        const tool = this.tools.get(action.tool);
        if (!tool) {
            this.pushFailureObservation(action, `未知的工具: ${action.tool}`);
            return true;
        }

        // 4. 参数校验
        const validation = tool.validate(action.params);
        if (!validation.valid) {
            this.pushFailureObservation(action, `参数校验失败: ${validation.errors.join('; ')}`);
            return true; // 继续循环，让模型修正
        }
        const cleanParams = validation.sanitized as ToolParams;

        const controller = new AbortController();
        const toolTimeout = setTimeout(
            () => controller.abort(),
            this.config.timeoutMs ?? 30000
        );

        // 5. 构建 ToolContext。审批在同一动作内只问一次：
        //    运行时用富预览问一次，工具内部若再次申请则复用该决定。
        const approvalCache: ApprovalCache = { decision: null };
        const ctx: ToolContext = {
            workspaceRoot: this.config.workspacePath,
            allowedPaths: [this.config.workspacePath],  // 后续由 fs-guard 管理
            runId: this.state.taskId,
            requestApproval: (pending) => this.approveOnce(approvalCache, pending),
            signal: controller.signal
        };

        try {
            // 6. 检查是否需要人工审批
            if (tool.permissions.requiresApproval) {
                const pending = await this.createPendingAction(action, tool, cleanParams);
                const approval = await ctx.requestApproval(pending);

                if (approval === 'reject') {
                    this.pushFailureObservation(action, '操作被人工拒绝');
                    return true;
                }
            }

            // 7. 执行工具（传入清洗后的参数）
            let result: ToolResult;
            try {
                result = await tool.execute(cleanParams, ctx);
            } catch (e: any) {
                result = {
                    success: false,
                    data: null,
                    error: `工具执行异常: ${e.message}`,
                };
            }

            // 8. 记录观察结果
            const observation: Observation = {
                action,
                result: {
                    success: result.success,
                    data: result.data,
                    error: result.error || '',
                },
                timestamp: Date.now(),
            };
            this.state.observations.push(observation);
            this.state.toolCallCount++;

            if (MODIFYING_TOOLS.includes(action.tool)) {
                for (const path of this.changedPaths(action)) {
                    this.state.fileChanges.push({ tool: action.tool, path, at: Date.now() });
                }
            }

            // 9. 检查工具执行是否成功
            if (!result.success) {
                this.failureHistory.push({
                    tool: action.tool,
                    error: result.error || '未知错误',
                    timestamp: Date.now(),
                });

                console.warn(`工具 ${action.tool} 执行失败:`, result.error);

                // 检查是否需要触发自动 Replan
                if (this.shouldAutoReplan(action.tool)) {
                    this.state.stopReason = {
                        type: 'error',
                        message: `工具 ${action.tool} 连续失败 ${this.MAX_RETRIES_PER_TOOL} 次，需要重新规划`,
                    };
                    return false;
                }
            }

            return true;
        } finally {
            clearTimeout(toolTimeout);
        }
    }



    /**
     * 记录一次「未能执行」的失败观察。
     *
     * 不计入 toolCallCount，也不写入失败历史 —— 这与既有语义保持一致：
     * 只有真正执行过的工具调用才消耗预算、才参与「连续失败」判定。
     */
    private pushFailureObservation(action: Action, message: string): void {
        this.state.observations.push({
            action,
            result: { success: false, data: null, error: message },
            timestamp: Date.now(),
        });
    }




    /**
     * 同一动作内只解析一次审批决定，避免运行时与工具各问一遍。
     */
    private async approveOnce(cache: ApprovalCache, pending: PendingAction): Promise<ApprovalDecision> {
        if (cache.decision) {
            return cache.decision;
        }
        const decision = await this.resolveApproval(pending);
        cache.decision = decision;
        return decision;
    }




    /**
     * 取得审批决定。
     *
     * 有交互层时完全由它决定；没有时按显式配置的策略处理，并告警一次。
     */
    private async resolveApproval(pending: PendingAction): Promise<ApprovalDecision> {
        if (this.config.requestApproval) {
            return this.config.requestApproval(pending);
        }

        const policy = this.config.approvalPolicy ?? 'auto-approve';
        if (!this.approvalWarned) {
            this.approvalWarned = true;
            console.warn(
                `[AgentRuntime] 未配置 requestApproval，按 approvalPolicy="${policy}" 处理审批；` +
                `待审批操作未经过人工确认：${pending.preview.summary}`
            );
        }
        return policy === 'auto-approve' ? 'approve' : 'reject';
    }


    
    /**
     * 取出动作实际触及的路径，用于记录文件变更。
     */
    private changedPaths(action: Action): string[] {
        const params = action.params as Record<string, unknown>;
        const paths: string[] = [];

        for (const key of ['path', 'source', 'destination'] as const) {
            const value = params[key];
            if (typeof value === 'string' && value) paths.push(value);
        }

        const many = params.paths;
        if (Array.isArray(many)) {
            for (const value of many) {
                if (typeof value === 'string' && value) paths.push(value);
            }
        }

        return paths;
    }


    /**
     *
     * @是否自动重新规划
     */
    private shouldAutoReplan(toolName: string): boolean {
        const now = Date.now();
        const recentFailures = this.failureHistory.filter(
            f => f.tool === toolName && (now - f.timestamp) < this.RETRY_WINDOW_MS
        );
        return recentFailures.length >= this.MAX_RETRIES_PER_TOOL;
    }


    /**
     * @创建PendingAction
     */
    private async createPendingAction(
        action: Action,
        tool: Tool<ToolParams>,
        params: ToolParams
    ): Promise<PendingAction> {
        const pending: PendingAction = {
            id: crypto.randomUUID(),
            runId: this.state.taskId,
            createdAt: Date.now(),
            source: {
                thought: action.thought || '',
                decision: action,
                contextSnapshot: {
                    currentPlan: this.formatPlanState(),
                    recentHistory: JSON.stringify(this.state.decisions.slice(-5)),
                    currentStep: this.state.plan.steps[this.state.plan.currentStepIndex]?.description || '',
                },
            },
            preview: {
                tool: action.tool,
                summary: this.generateSummary(action, params),
                affectedFiles: this.generateAffectedFiles(action, params),
                riskLevel: this.assessRisk(action),
            },
            status: 'pending',
            expiresAt: Date.now() + 5 * 60 * 1000,
        };

        this.pendingActions.set(pending.id, pending);
        return pending;
    }


    /**
     * 生成人类可读的操作摘要
     */
    private generateSummary(action: Action, params: ToolParams): string {
        switch (action.tool) {
            case 'edit_file': {
                const p = params as any;
                return `修改文件 ${p.path}：替换 "${String(p.old_string).slice(0, 50)}..."`;
            }
            case 'delete_file': {
                const p = params as any;
                return `删除文件 ${p.path}`;
            }
            case 'create_file': {
                const p = params as any;
                return `创建新文件 ${p.path}`;
            }
            case 'move_file': {
                const p = params as any;
                return `移动文件 ${p.source} → ${p.destination}`;
            }
            case 'apply_diff': {
                const p = params as any;
                return `修改文件 ${p.path}：替换匹配的文本段`;
            }
            case 'git_operation': {
                const p = params as any;
                return `Git ${p.operation}${p.message ? ': ' + p.message : ''}`;
            }
            case 'fetch_url': {
                const p = params as any;
                return `获取远程内容: ${p.url}`;
            }
            case 'search_code': {
                const p = params as any;
                return `搜索代码: ${p.pattern}`;
            }
            case 'run_command': {
                const p = params as any;
                return `执行命令: ${String(p.command).slice(0, 80)}`;
            }
            case 'list_files': {
                const p = params as any;
                return `列出文件: ${p.pattern || '(全部)'}`;
            }
            case 'read_directory': {
                const p = params as any;
                return `读取目录结构: ${p.path || '.'}`;
            }
            default:
                return `执行 ${action.tool}`;
        }
    }



    /**
     * 生成受影响的文件列表
     */
    private generateAffectedFiles(
        action: Action,
        params: ToolParams
    ): PendingAction['preview']['affectedFiles'] {
        switch (action.tool) {
            case 'edit_file': {
                const p = params as any;
                return [{
                    path: p.path,
                    changeType: 'modify' as const,
                    diffPreview: this.generateDiff(p.old_string, p.new_string),
                }];
            }
            case 'delete_file': {
                const p = params as any;
                return [{
                    path: p.path,
                    changeType: 'delete' as const,
                }];
            }
            case 'create_file': {
                const p = params as any;
                return [{
                    path: p.path,
                    changeType: 'create' as const,
                }];
            }
            default:
                return [];
        }
    }

    /**
    * 评估风险等级
    */
    private assessRisk(action: Action): 'low' | 'medium' | 'high' {
        switch (action.tool) {
            case 'delete_file':
            case 'git_operation':
                return 'high';
            case 'edit_file':
            case 'create_file':
            case 'move_file':
            case 'apply_diff':
            case 'run_command':
                return 'medium';
            case 'fetch_url':
                return 'medium';  // 网络请求有安全隐患
            default:
                return 'low';
        }
    }

    /**
     * 生成 diff 预览
     */
    private generateDiff(oldStr: string, newStr: string): string {
        return `--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n-${oldStr}\n+${newStr}`;
    }


    /**
     * 处理重新规划
     */
    private async handleReplan(decision: ModelDecision & { type: 'Replan' }): Promise<boolean> {
        // 1. 标记当前步骤为失败
        const currentStep = this.state.plan.steps[this.state.plan.currentStepIndex];
        if (currentStep) {
            currentStep.status = 'failed';
        }

        // 2. 创建新计划版本
        this.state.plan.version++;
        this.state.plan.steps = [
            // 保留已完成的步骤
            ...this.state.plan.steps.filter(s => s.status === 'completed'),
            // 添加新的步骤
            ...decision.newPlan.map((step, index) => ({
                ...step,
                id: `v${this.state.plan.version}-step-${index + 1}`,
            })),
        ];

        // 3. 重置当前步骤索引到第一个未完成的步骤
        this.state.plan.currentStepIndex = this.state.plan.steps.findIndex(
            s => s.status === 'pending'
        );

        console.log(`计划已更新到 v${this.state.plan.version}，原因: ${decision.reason}`);

        return true;
    }

    /**
     * 构建发送给模型的上下文消息
     *
     * 从运行时记录的决策与观察重建真实消息序列：助手消息携带工具调用，
     * 紧随的工具结果消息通过调用标识与之关联（见 agent-runtime spec）。
     */
    private buildContextMessages(): ChatMessage[] {
        const messages: ChatMessage[] = [
            { role: 'system', content: this.buildSystemPrompt() },
            {
                role: 'user',
                content: `任务目标: ${this.state.plan.originalGoal}\n\n${this.formatPlanState()}`,
            },
        ];

        // 观察按执行顺序记录；一次 Action 消耗一条，一次 BatchAction 消耗 N 条。
        let cursor = 0;

        this.state.decisions.forEach((decision, decisionIndex) => {
            switch (decision.type) {
                case 'Action': {
                    const observation = this.state.observations[cursor];
                    cursor += 1;
                    messages.push(this.toAssistantToolCallMessage([decision], decisionIndex));
                    if (observation) {
                        messages.push(this.toToolResultMessage(decision, observation, this.callIdOf(decision, decisionIndex, 0)));
                    }
                    break;
                }
                case 'BatchAction': {
                    const count = decision.actions.length;
                    const observations = this.state.observations.slice(cursor, cursor + count);
                    cursor += count;
                    messages.push(this.toAssistantToolCallMessage(decision.actions, decisionIndex));
                    decision.actions.forEach((subAction, subIndex) => {
                        const observation = observations[subIndex];
                        if (observation) {
                            messages.push(this.toToolResultMessage(subAction, observation, this.callIdOf(subAction, decisionIndex, subIndex)));
                        }
                    });
                    break;
                }
                case 'Replan':
                    messages.push({ role: 'assistant', content: `[重新规划] ${decision.reason}` });
                    break;
                case 'Final':
                    messages.push({ role: 'assistant', content: decision.answer });
                    break;
            }
        });

        messages.push({
            role: 'user',
            content: '请根据以上信息决定下一步：需要时调用工具，不再需要时直接给出最终答复。',
        });

        return sanitizeMessageSequence(messages);
    }

    /**
     * 工具调用标识：优先使用模型返回的原始标识，没有时按位置合成。
     */
    private callIdOf(action: ActionLike, decisionIndex: number, subIndex: number): string {
        return action.toolCallId ?? `call_${decisionIndex}_${subIndex}`;
    }

    /**
     * 构造携带工具调用的助手消息。
     *
     * content 固定为 null：Qwen Code 的 ensureToolResultPairing 会在模型消息带
     * 函数调用时剥掉文本部分，这里直接不产生文本，避免消息序列非法。
     */
    private toAssistantToolCallMessage(actions: ActionLike[], decisionIndex: number): AssistantMessage {
        const toolCalls: ToolCall[] = actions.map((action, subIndex) => ({
            index: subIndex,
            id: this.callIdOf(action, decisionIndex, subIndex),
            type: 'function',
            function: {
                name: action.tool,
                arguments: JSON.stringify(action.params ?? {}),
            },
        }));

        return { role: 'assistant', content: null, tool_calls: toolCalls };
    }

    /**
     * 构造工具结果消息。内容取自实际观察，而不是模型复述。
     *
     * 送入模型前统一收进输出预算（见 design.md D5）：工具自身声明的预算优先，
     * 未声明时用配置或推导的全局默认兜底 —— 后者保证新增工具（含未来 MCP
     * 接入的工具）在忘记声明时也不会产生无限输出。
     */
    private toToolResultMessage(action: ActionLike, observation: Observation, toolCallId: string): ToolMessage {
        const error = observation.result.error ?? '';

        // 成功但没有任何输出内容：给明确占位，而不是让模型面对空内容
        if (observation.result.success && !error && !hasOutputPayload(observation.result.data)) {
            return {
                role: 'tool',
                tool_call_id: toolCallId,
                name: action.tool,
                content: NO_OUTPUT_PLACEHOLDER,
            };
        }

        const payload = JSON.stringify({
            success: observation.result.success,
            data: observation.result.data,
            error,
        });

        const tool = this.tools.get(action.tool);
        const judgement = this.getContextBudget();

        const outcome = applyOutputBudget(payload, {
            toolName: action.tool,
            workspaceRoot: this.config.workspacePath,
            global: {
                maxChars: judgement.toolOutput.maxChars,
                maxLines: judgement.toolOutput.maxLines,
            },
            ...(tool?.outputBudget !== undefined ? { budget: tool.outputBudget } : {}),
        });

        // 截断后不直接把截断的 JSON 当结果发出去（那会变成非法 JSON），
        // 而是换成带全文位置的结构化结果。
        const content = outcome.truncated
            ? JSON.stringify({
                success: observation.result.success,
                error,
                truncated: true,
                originalLength: outcome.originalLength,
                fullOutputPath: outcome.fullOutputPath ?? null,
                output: outcome.content,
            })
            : outcome.content;

        return {
            role: 'tool',
            tool_call_id: toolCallId,
            name: action.tool,
            content,
        };
    }

    /**
     * 构建 System Prompt
     *
     * 工具由请求的 tools 声明下发，提示词只说明工作方式，不再要求模型
     * 输出某种 JSON 格式（见 design.md D2/D3）。
     */
    private buildSystemPrompt(): string {
    

            // 不用写把工具写入prompts

        return `你是一个 AI 编码助手，需要在用户的工作区中完成开发任务。

工作方式：
- 需要读取或修改文件、执行命令时，调用相应工具。
- 工具的执行结果会在下一轮作为工具结果返回给你。
- 当你不再需要调用任何工具时，直接给出最终答复，任务就此结束。
- 如果当前计划已不可行，可调用 ${REQUEST_REPLAN_TOOL} 提交一份新的步骤列表。
- 若多个动作之间没有依赖关系，可调用 ${BATCH_TOOL} 一次性提交以并发执行。

注意事项：
- 参数必须符合各工具声明的 schema。
- 工具调用失败时先看清错误信息再决定下一步，不要重复同样的调用。
- 变更代码后应运行相关测试确认。`;
    }

    /**
     * 格式化当前计划状态
     */
    private formatPlanState(): string {
        const steps = this.state.plan.steps
            .map((s, i) => {
                const status = s.status === 'completed' ? '✅' :
                    s.status === 'failed' ? '❌' :
                        s.status === 'in_progress' ? '🔄' : '⏳';
                return `${status} Step ${i + 1}: ${s.description}`;
            })
            .join('\n');

        return `当前计划 (v${this.state.plan.version}):
${steps}`;
    }


    /**
     * 验证任务是否完成
     *
     * 由运行时自行推断并执行验证手段，结论不取自模型自述
     * （见 task-verification spec）。
     */
    private async verifyTask(): Promise<TaskVerificationResult> {
        const workspaceRoot = this.config.workspacePath;
        const diffSummary = this.buildDiffSummary();
        const commands = this.inferVerificationCommands(workspaceRoot);

        if (commands.length === 0) {
            return {
                passed: false,
                verificationStatus: 'unavailable',
                testResults: { passed: 0, failed: 0, output: '' },
                typeCheckPassed: null,
                typeCheckOutput: '',
                diffSummary,
                completionCriteriaMet: false,
                details: '工作区未声明测试脚本，也不存在类型检查配置，验收结论不可判定（不可判定不等于通过）',
            };
        }

        const timeoutMs = this.config.verificationTimeoutMs ?? 120000;
        let testResults = { passed: 0, failed: 0, output: '' };
        let typeCheckPassed: boolean | null = null;
        let typeCheckOutput = '';
        const details: string[] = [];
        let allPassed = true;

        for (const command of commands) {
            const outcome = this.runVerificationCommand(command.command, workspaceRoot, timeoutMs);

            if (command.kind === 'test') {
                testResults = { ...parseTestCounts(outcome.output), output: outcome.output };
            } else {
                typeCheckPassed = outcome.ok;
                typeCheckOutput = outcome.output;
            }

            details.push(`${command.kind} [${command.command}] -> ${outcome.ok ? '通过' : '失败'} (exit ${outcome.status})`);
            if (!outcome.ok) allPassed = false;
        }

        const completed = this.state.stopReason?.type === 'task_completed';

        return {
            passed: allPassed,
            verificationStatus: 'executed',
            testResults,
            typeCheckPassed,
            typeCheckOutput,
            diffSummary,
            completionCriteriaMet: completed && allPassed,
            details: details.join('\n'),
        };
    }

    /**
     * 从工作区推断验证手段：优先项目声明的测试脚本，存在类型检查配置时追加。
     *
     * 类型检查只在工作区**本地**存在 typescript 时才纳入：不擅自安装依赖，
     * 也避免「配置存在但工具不可用」被误报为类型检查失败（那种情形记为未执行）。
     */
    private inferVerificationCommands(
        workspaceRoot: string
    ): Array<{ kind: 'test' | 'typecheck'; command: string }> {
        const commands: Array<{ kind: 'test' | 'typecheck'; command: string }> = [];

        const packageJsonPath = join(workspaceRoot, 'package.json');
        if (existsSync(packageJsonPath)) {
            try {
                const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
                if (pkg?.scripts?.test) {
                    commands.push({ kind: 'test', command: 'npm test' });
                }
            } catch {
                // 配置不可解析时视为没有声明测试脚本
            }
        }

        const localTsc = join(workspaceRoot, 'node_modules', 'typescript', 'bin', 'tsc');
        if (existsSync(join(workspaceRoot, 'tsconfig.json')) && existsSync(localTsc)) {
            commands.push({ kind: 'typecheck', command: `node "${localTsc}" --noEmit` });
        }

        return commands;
    }

    /**
     * 实际执行一条验证命令。
     */
    private runVerificationCommand(
        command: string,
        cwd: string,
        timeoutMs: number
    ): { ok: boolean; status: number; output: string } {
        const result = spawnSync(command, {
            cwd,
            shell: true,
            timeout: timeoutMs,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
        });

        const output = [result.stdout, result.stderr]
            .filter((part): part is string => typeof part === 'string' && part.length > 0)
            .join('\n');

        return { ok: result.status === 0, status: result.status ?? -1, output };
    }

    /**
     * 变更摘要：列出运行期间实际改动过的文件。
     */
    private buildDiffSummary(): string {
        const paths = [...new Set(this.state.fileChanges.map(change => change.path))];

        if (paths.length === 0) {
            return '运行期间没有文件变更';
        }

        return `共改动 ${paths.length} 个文件：\n${paths.map(path => `- ${path}`).join('\n')}`;
    }
}


/**
 * 兜底计划的新副本。
 *
 * 每次运行都拿到独立的步骤对象：计划状态在运行中会被改写（状态、当前步骤索引），
 * 共用一份常量会让上一次运行的结果泄漏到下一次。
 */
function cloneFallbackPlan(): PlanStep[] {
    return FALLBACK_PLAN_STEPS.map(step => ({ ...step, dependsOn: [...step.dependsOn] }));
}

/**
 * 把模型提交的步骤规范成合法计划（PlanStep 的类型约束）。
 *
 * 模型输出是不可信的，即使它已经过一次边界翻译：id 可能缺失或重复、
 * dependsOn 可能指向不存在的步骤甚至指向自己、状态可能自报已完成。
 * 这里统一收敛到「id 唯一 + 依赖闭合 + 全部 pending」的形状，
 * 使计划可以直接驱动后续的步骤推进。
 *
 * id 一律按位置重编：模型声明的 id 只用于解析依赖关系，它的取值本身
 * 不参与计划语义。没有描述的步骤无法推进也无法交代，直接丢弃。
 */
function normalizePlanSteps(raw: unknown): PlanStep[] {
    if (!Array.isArray(raw)) return [];

    const kept: Record<string, unknown>[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const candidate = entry as Record<string, unknown>;
        const description = typeof candidate.description === 'string' ? candidate.description.trim() : '';
        if (!description) continue;
        kept.push(candidate);
    }

    // 先建立「模型声明的 id → 运行时重编后的 id」映射，重复声明只认第一次出现
    const idMap = new Map<string, string>();
    kept.forEach((entry, index) => {
        const declared = typeof entry.id === 'string' ? entry.id.trim() : '';
        if (declared && !idMap.has(declared)) {
            idMap.set(declared, stepId(index));
        }
    });

    return kept.map((entry, index) => {
        const id = stepId(index);
        return {
            id,
            description: (entry.description as string).trim(),
            // 新计划一律从 pending 开始，不接受模型自报已完成
            status: 'pending',
            dependsOn: normalizeDependencies(entry.dependsOn, idMap, id),
            completionCriteria: typeof entry.completionCriteria === 'string' ? entry.completionCriteria : '',
        };
    });
}

/** 计划步骤的 id 编号口径，与 handleReplan 的位置编号保持一致 */
function stepId(index: number): string {
    return `step-${index + 1}`;
}

/**
 * 解析依赖：只保留能落到计划内的引用，丢掉未知 id 与自引用。
 */
function normalizeDependencies(raw: unknown, idMap: Map<string, string>, selfId: string): string[] {
    if (!Array.isArray(raw)) return [];

    const dependencies: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== 'string') continue;
        const resolved = idMap.get(entry.trim());
        if (!resolved || resolved === selfId || dependencies.includes(resolved)) continue;
        dependencies.push(resolved);
    }
    return dependencies;
}

/**
 * 判定一次成功的工具调用是否真的产出了内容。
 *
 * null / undefined / 空字符串 / 空数组 / 空对象都算「没有输出」，
 * 此时送入模型的应当是明确的占位说明，而不是空内容。
 */
function hasOutputPayload(data: unknown): boolean {
    if (data === null || data === undefined) return false;
    if (typeof data === 'string') return data.trim() !== '';
    if (Array.isArray(data)) return data.length > 0;
    if (typeof data === 'object') return Object.keys(data as object).length > 0;
    return true; // 数字、布尔等标量视为有内容
}

/** 消息的字符数（含工具调用的参数），用于缺失真实用量时的粗略推算 */
function messageCharCount(message: ChatMessage): number {
    let chars = message.content?.length ?? 0;
    if (message.role === 'assistant' && message.tool_calls) {
        for (const call of message.tool_calls) {
            chars += call.function.name.length + call.function.arguments.length;
        }
    }
    return chars;
}

/**
 * 按字符数粗略推算 token。
 *
 * 只在模型响应没有带回真实用量时使用；「4 字符约 1 token」是通用经验值，
 * 足够让度量有数可读。调用方会把来源标注为「估算」，不与实测混同。
 */
function estimateTokensFromChars(chars: number): number {
    return Math.ceil(chars / 4);
}

/**
 * 从测试运行器的汇总行里取通过与失败数量。
 *
 * 只认退出码是权威结论，数量是补充信息：汇总行取不到时保持 0，
 * 真实成败仍由退出码决定（详见 verifyTask 的 details）。
 *
 * 匹配前必须先剥掉 ANSI 颜色转义：测试运行器默认输出彩色汇总行，
 * 形如 `\u001b[2m  Tests \u001b[22m \u001b[1m\u001b[32m86 passed\u001b[39m`，
 * 转义序列是非空白字符，不剥掉会直接匹配失败、计数恒为 0。
 */
function parseTestCounts(output: string): { passed: number; failed: number } {
    const plain = output.replace(/\u001b\[[0-9;]*m/g, '');
    const match = plain.match(/Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed/);
    if (!match) {
        return { passed: 0, failed: 0 };
    }
    return {
        passed: Number(match[2] ?? 0),
        failed: Number(match[1] ?? 0),
    };
}


/**
 * 消息序列合法性清理（见 design.md D5）。
 *
 * DeepSeek 官方明确 Chat Completion API 不支持中途插入 tool calls，因此提交前
 * 必须保证：每个工具调用都有结果、每个结果都有对应的调用。
 *
 * 规则：
 *   - 只保留「调用与结果都存在」的工具调用；无结果的调用被移除
 *   - 无对应调用的工具结果被丢弃
 *   - 调用被全部移除的助手消息降级为纯文本（文本为空则整条丢弃）
 *   - 连续的纯文本助手消息合并
 */
export function sanitizeMessageSequence(messages: ChatMessage[]): ChatMessage[] {
    const calledIds = new Set<string>();
    const resultIds = new Set<string>();

    for (const message of messages) {
        if (message.role === 'assistant' && message.tool_calls) {
            for (const call of message.tool_calls) calledIds.add(call.id);
        }
        if (message.role === 'tool' && message.tool_call_id) {
            resultIds.add(message.tool_call_id);
        }
    }

    const pairedIds = new Set<string>();
    for (const id of calledIds) {
        if (resultIds.has(id)) pairedIds.add(id);
    }

    const cleaned: ChatMessage[] = [];
    for (const message of messages) {
        if (message.role === 'assistant' && message.tool_calls) {
            const kept = message.tool_calls.filter(call => pairedIds.has(call.id));
            if (kept.length === 0) {
                // 调用全部被清理：保留文本（若有），否则整条丢弃
                if (message.content) {
                    cleaned.push({ role: 'assistant', content: message.content });
                }
                continue;
            }
            cleaned.push({
                role: 'assistant',
                content: message.content ?? null,
                tool_calls: kept.map((call, index) => ({ ...call, index })),
            });
            continue;
        }
        if (message.role === 'tool') {
            if (!message.tool_call_id || !pairedIds.has(message.tool_call_id)) continue;
            cleaned.push(message);
            continue;
        }
        cleaned.push(message);
    }

    // 合并连续的纯文本助手消息
    const merged: ChatMessage[] = [];
    for (const message of cleaned) {
        if (message.role === 'assistant' && !message.tool_calls?.length) {
            const previous = merged[merged.length - 1];
            if (previous && previous.role === 'assistant' && !previous.tool_calls?.length) {
                const combined = [previous.content, message.content].filter(Boolean).join('\n');
                merged[merged.length - 1] = { role: 'assistant', content: combined || null };
                continue;
            }
        }
        merged.push(message);
    }

    return merged;
}
