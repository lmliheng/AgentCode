import { ref, reactive } from 'vue';
import { AgentRuntime } from '../../runtime/agent.runtime.js';
import { DeepSeekProvider } from '../../provider/deepseek.provider.js'
import type { Tool } from '../../types/Tool.js'
import type { PendingAction, ApprovalDecision } from '../../types/Tool.js';
import { ReadFileTool } from '../../tools/read_file.js';
import { ApplyDiffTool } from '../../tools/apply_diff.js';
import { CreateFileTool } from '../../tools/create_file.js';
import { DeleteFileTool } from '../../tools/delete_file.js';
import { EditFileTool } from '../../tools/edit_file.js';
import { FetchUrlTool } from '../../tools/fetch_url.js';
import { GitOperationTool } from '../../tools/git_operation.js';
import { ListFilesTool } from '../../tools/list_files.js';
import { MoveFileTool } from '../../tools/move_file.js';
import { ReadDirectoryTool } from '../../tools/read_directory.js';
import { RunCommandTool } from '../../tools/run_command.js';
import { SearchCodeTool } from '../../tools/search_code.js';


export function loadTools(): Tool[] {
    return [
        new ReadFileTool(),
        new ApplyDiffTool(),
        new RunCommandTool(),
        new FetchUrlTool(),
        new CreateFileTool(),
        new GitOperationTool(),
        new ListFilesTool(),
        new EditFileTool(),
        new ReadDirectoryTool(),
        new DeleteFileTool(),
        new MoveFileTool(),
        new SearchCodeTool(),
    ];
}


export interface AgentMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content?: string;
    thought?: string;
    answer?: string;
    toolCall?: {
        tool: string;
        params: Record<string, unknown>;
        status: 'running' | 'success' | 'failed';
        result?: any;
    };
}

export function useAgent() {
    const messages = ref<AgentMessage[]>([]);
    const isRunning = ref(false);
    const pendingApproval = ref<PendingAction | null>(null);
    const stats = reactive({
        toolCallCount: 0,
        iterationCount: 0,
        totalTokens: 0,
        tokenUsageComplete: true,
        modelName: 'deepseek-chat',
    });

    let runtime: AgentRuntime | null = null;
    let approvalResolve: ((value: ApprovalDecision) => void) | null = null;

    function initRuntime(config: {
        workspacePath: string;
        apiKey: string;
        modelName?: string;
        maxIterations?: number;
        maxConcurrency?: number;
    }) {
        const tools = loadTools();
        const provider = new DeepSeekProvider({
            apiKey: config.apiKey,
            modelName: config.modelName ?? 'deepseek-chat',
            temperature: 0.1,
            maxTokens: 8192,
        });

        runtime = new AgentRuntime(provider, tools, {
            workspacePath: config.workspacePath,
            maxIterations: config.maxIterations ?? 50,
            maxConcurrency: config.maxConcurrency ?? 3,
            // 审批由交互层决定：把待审批操作交给 UI，并保持阻塞直到用户按键
            requestApproval: (action: PendingAction) => {
                pendingApproval.value = action;
                return new Promise<ApprovalDecision>((resolve) => {
                    approvalResolve = resolve;
                });
            },
        });

        stats.modelName = config.modelName ?? 'deepseek-chat';
    }

    async function submitPrompt(prompt: string) {
        if (!runtime || isRunning.value) return;

        isRunning.value = true;
        pendingApproval.value = null;

        messages.value.push({
            id: `user-${Date.now()}`,
            role: 'user',
            content: prompt,
        });

        try {
            const result = await runtime.run(prompt);

            // 添加最终答案
            const lastDecision = result.state.decisions[result.state.decisions.length - 1];
            if (lastDecision?.type === 'Final') {
                messages.value.push({
                    id: `answer-${Date.now()}`,
                    role: 'assistant',
                    answer: lastDecision.answer,
                });
            }

            // 更新统计
            stats.toolCallCount = result.state.toolCallCount;
            stats.iterationCount = result.state.iterationCount;
            stats.totalTokens = result.state.tokenUsage.totalTokens;
            stats.tokenUsageComplete = result.state.tokenUsage.complete;
        } catch (err: any) {
            messages.value.push({
                id: `error-${Date.now()}`,
                role: 'system',
                content: `错误: ${err.message}`,
            });
        } finally {
            isRunning.value = false;
            pendingApproval.value = null;
            approvalResolve = null;
        }
    }

    function handleApproval(action: ApprovalDecision) {
        if (approvalResolve) {
            approvalResolve(action);
            approvalResolve = null;
        }
        pendingApproval.value = null;
    }

    return {
        messages,
        isRunning,
        stats,
        pendingApproval,
        initRuntime,
        submitPrompt,
        handleApproval,
    };
}
