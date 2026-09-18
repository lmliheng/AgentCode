import type { AgentProvider, ToolDefinition } from '../types/AgentProvider.js';
import type { ChatMessage } from '../types/Message.js';

import type {
    ModelDecision,
    AgentRunState,
    PlanState,
    PlanStep,
    Observation,
    StopReason,
    TaskVerificationResult,
} from '../types/ReAct.js';

import type { AgentRuntimeConfig } from '../types/Runtime.js'
import type { Tool, ToolParams, PendingAction, ToolContext, ToolResult } from '../types/Tool.js';


interface FailureRecord {
    tool: string;
    error: string;
    timestamp: number;
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
 */
export class AgentRuntime {
    private provider: AgentProvider;
    private tools: Map<string, Tool<ToolParams>>;
    private config: AgentRuntimeConfig;
    private state!: AgentRunState;
    private pendingActions: Map<string, PendingAction> = new Map();  // 新增

    private failureHistory: FailureRecord[] = [];
    private readonly MAX_RETRIES_PER_TOOL = 3;
    private readonly RETRY_WINDOW_MS = 60000; // 1分钟内同一工具失败超过3次则触发replan
    private readonly maxConcurrency: number
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

        try {
            // 2. 生成初始计划
            await this.createInitialPlan(taskDescription);

            // 3. 进入主循环
            while (!this.shouldStop()) {
                // 3.1 检查是否需要人工确认
                await this.checkHumanInTheLoop();

                // 3.2 构建上下文消息
                const messages = this.buildContextMessages();

                const toolDefinitions: ToolDefinition[] = Array.from(this.tools.values()).map(tool => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.getSchema() as Record<string, unknown>,
                }));
                // 3.3 让模型决策
                const response = await this.provider.decide(messages, toolDefinitions);
                const decision = response.decision;

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
        };
    }

    /**
     * 生成初始计划
     * 
     * 这里我们先用一个简单的策略：
     * 将任务描述发给模型，让它生成一个初步的计划
     * 后续 Plan-and-Execute 模块会完善这个逻辑
     */
    private async createInitialPlan(taskDescription: string): Promise<void> {
        // 暂时使用一个默认计划
        // 后续会由 Planner 模块接管
        this.state.plan.steps = [
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
            const decision: ModelDecision & { type: 'Action' } = {
                type: 'Action',
                tool: subAction.tool,
                params: subAction.params,
                thought: subAction.thought || '',
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
     */
    private async executeAction(action: ModelDecision & { type: 'Action' }): Promise<boolean> {
        // 1. 查找工具
        const tool = this.tools.get(action.tool);
        if (!tool) {
            throw new Error(`未知的工具: ${action.tool}`);
        }

        // 2. 检查工具调用次数
        if (this.state.toolCallCount >= this.config.maxToolCalls) {
            return false;
        }

        const validation = tool.validate(action.params);
        if (!validation.valid) {
            // 参数不合法，直接返回错误 Observation
            const observation: Observation = {
                action,
                result: {
                    success: false,
                    data: null,
                    error: `参数校验失败: ${validation.errors.join('; ')}`,
                },
                timestamp: Date.now(),
            };
            this.state.observations.push(observation);
            return true; // 继续循环，让模型修正
        }

        const controller = new AbortController();
        const toolTimeout = setTimeout(
            () => controller.abort(),
            this.config.timeoutMs ?? 30000
        );

        // 2. 使用清洗后的参数
        const cleanParams = validation.sanitized as ToolParams;

        // 3. 构建 ToolContext
        const ctx: ToolContext = {
            workspaceRoot: this.config.workspacePath,
            allowedPaths: [this.config.workspacePath],  // 后续由 fs-guard 管理
            runId: this.state.taskId,
            requestApproval: async (pendingAction) => {
                this.pendingActions.set(pendingAction.id, pendingAction);
                // 触发 UI 事件（实际项目用 EventEmitter）
                console.log(`\n需要人工确认的操作:`);
                console.log(`工具: ${pendingAction.preview.tool}`);
                console.log(`摘要: ${pendingAction.preview.summary}`);
                console.log(`风险等级: ${pendingAction.preview.riskLevel}`);
                console.log(`请输入 y/n: `);

                // 这里在实际项目中会等待 UI 响应
                // 目前简单处理：自动批准
                return 'approve';
            },
            signal: controller.signal
        };

        // 4. 检查是否需要人工审批
        if (tool.permissions.requiresApproval) {
            const pending = await this.createPendingAction(action, tool, cleanParams);
            const approval = await ctx.requestApproval(pending);

            if (approval === 'reject') {
                const observation: Observation = {
                    action,
                    result: {
                        success: false,
                        data: null,
                        error: '操作被人工拒绝',
                    },
                    timestamp: Date.now(),
                };
                this.state.observations.push(observation);
                return true;
            }
        }

        //执行工具（传入清洗后的参数）
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
        // 4. 记录观察结果
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

        const modifyingTools = ['edit_file', 'delete_file', 'create_file', 'move_file', 'apply_diff', 'git_operation'];

        if (modifyingTools.includes(action.tool)) {
            this.state.fileChanges.push(`${action.tool}: ${JSON.stringify(action.params)}`);
        }

        // 6. 检查工具执行是否成功
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
        action: ModelDecision & { type: 'Action' },
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
    private generateSummary(action: ModelDecision & { type: 'Action' }, params: ToolParams): string {
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
        action: ModelDecision & { type: 'Action' },
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
            case 'write_file': {
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
    private assessRisk(action: ModelDecision & { type: 'Action' }): 'low' | 'medium' | 'high' {
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
     * 构建 ToolContext
     */
    private buildToolContext(): ToolContext {
        return {
            workspaceRoot: this.config.workspacePath,
            allowedPaths: [this.config.workspacePath],
            runId: this.state.taskId,
            requestApproval: async (pendingAction) => {
                this.pendingActions.set(pendingAction.id, pendingAction);
                console.log(`\n 需要人工确认的操作: ${pendingAction.preview.summary}`);
                // 实际项目中这里会等待 UI 响应
                return 'approve';
            },
        };
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
     */
    private buildContextMessages(): ChatMessage[] {
        const messages: ChatMessage[] = [];

        // 1. System Prompt
        messages.push({
            role: 'system',
            content: this.buildSystemPrompt(),
        });

        // 2. 任务描述
        messages.push({
            role: 'user',
            content: `任务目标: ${this.state.plan.originalGoal}`,
        });

        // 3. 当前计划状态
        messages.push({
            role: 'user',
            content: this.formatPlanState(),
        });

        // 4. 最近的决策和观察（最近 10 条）
        const recentHistory = this.buildRecentHistory();
        for (const entry of recentHistory) {
            messages.push(entry);
        }

        // 5. 提示模型做出下一个决策
        messages.push({
            role: 'user',
            content: '请根据以上信息，做出下一个决策（Action/Replan/Final）：',
        });

        return messages;
    }

    /**
     * 构建 System Prompt
     */
    private buildSystemPrompt(): string {
        const toolDescriptions = Array.from(this.tools.values())
            .map(t => `- ${t.name}: ${t.description}`)
            .join('\n');

        return `你是一个 AI 编码助手，需要帮助用户完成后端开发任务。

你可以使用以下工具：
${toolDescriptions}

你的决策必须是以下三种格式之一：

1. Action：调用一个工具
   {"type": "Action", "tool": "工具名", "params": {...}, "thought": "思考过程"}

2. Replan：当前计划不可行，需要重新规划
   {"type": "Replan", "reason": "原因", "newPlan": [...], "thought": "思考过程"}

3. Final：任务已完成
   {"type": "Final", "answer": "总结", "thought": "思考过程"}

注意事项：
- 每次只调用一个工具
- 工具调用失败时，尝试其他方法
- 如果发现计划不合理，及时重新规划
- 任务完成时，务必输出 Final`;
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
     * 构建最近的决策历史
     */
    private buildRecentHistory(): ChatMessage[] {
        const history: ChatMessage[] = [];
        const maxEntries = 10;

        // 取最近的决策和观察
        const startIdx = Math.max(0, this.state.decisions.length - maxEntries);

        for (let i = startIdx; i < this.state.decisions.length; i++) {
            const decision = this.state.decisions[i]!;
            const observation = this.state.observations[i];

            // 添加决策
            history.push({
                role: 'assistant',
                content: JSON.stringify(decision),
            });

            // 添加观察结果
            if (observation) {
                history.push({
                    role: 'user',
                    content: `工具执行结果:\n${JSON.stringify(observation.result, null, 2)}`,
                });
            }
        }

        return history;
    }



    /**
     * 检查是否需要人工确认
     * 
     * 目前是一个占位实现，后续会接入真正的 UI 确认机制
     */
    private async checkHumanInTheLoop(): Promise<void> {
        const lastDecision = this.state.decisions[this.state.decisions.length - 1];

        if (lastDecision?.type === 'Action') {
            const action = lastDecision;
            // 敏感操作需要确认
            const sensitiveTools = ['edit_file', 'delete_file', 'create_file', 'move_file', 'apply_diff', 'run_command', 'git_operation'];
            if (sensitiveTools.includes(action.tool)) {
                console.log(`\n 需要人工确认的操作:`);
                console.log(`工具: ${action.tool}`);
                console.log(`参数: ${JSON.stringify(action.params, null, 2)}`);
                console.log(`思考: ${action.thought}`);
                console.log(`请输入 y 确认执行，其他键跳过: `);
            }
        }
    }



    /**
     * 验证任务是否完成
     */
    private async verifyTask(): Promise<TaskVerificationResult> {
        // 这是一个占位实现
        // 后续会集成实际的测试运行、类型检查等
        return {
            passed: this.state.stopReason?.type === 'task_completed',
            testResults: { passed: 0, failed: 0, output: '' },
            typeCheckPassed: false,
            diffSummary: `修改了 ${this.state.fileChanges.length} 个文件`,
            completionCriteriaMet: this.state.stopReason?.type === 'task_completed',
            details: this.state.stopReason
                ? `停止原因: ${JSON.stringify(this.state.stopReason)}`
                : '未知',
        };
    }




}