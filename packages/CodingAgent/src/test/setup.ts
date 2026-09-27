// src/test/setup.ts

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, dirname, sep } from 'path';
import { tmpdir } from 'os';
import type { ModelResponse } from '../types/AgentProvider.js';
import type { ModelDecision } from '../types/ReAct.js';

/**
 * 运行时在进入 ReAct 循环前会先请求一次初始计划（见 AgentRuntime.createInitialPlan）：
 * 它把工具声明随请求下发，并要求模型通过 request_replan 提交步骤列表。
 *
 * 因此「按脚本逐轮返回决策」的测试 Provider，其脚本第一位要留给规划轮；
 * 只关心循环行为的用例用下面的工厂补上这一轮。
 */
export function initialPlanDecision(): ModelDecision {
    return {
        type: 'Replan',
        reason: '初始规划',
        newPlan: [
            {
                id: 'step-1',
                description: '理解任务与相关代码',
                status: 'pending',
                dependsOn: [],
                completionCriteria: '已确认改动点',
            },
            {
                id: 'step-2',
                description: '完成代码变更',
                status: 'pending',
                dependsOn: ['step-1'],
                completionCriteria: '变更已完成',
            },
            {
                id: 'step-3',
                description: '运行测试验证',
                status: 'pending',
                dependsOn: ['step-2'],
                completionCriteria: '测试通过',
            },
        ],
    };
}

/** 规划轮的固定响应，供按 ModelResponse 排队的 Provider 使用 */
export function initialPlanResponse(): ModelResponse {
    const decision = initialPlanDecision();
    return { decision, rawContent: JSON.stringify(decision) };
}

/**
 * 创建测试工作区
 * @param files 文件映射表 { 'path/to/file.ts': 'content' }
 * @returns 工作区根目录路径
 */
export function createTestWorkspace(files: Record<string, string>): string {
    // 创建临时目录
    const dir = mkdtempSync(join(tmpdir(), 'coding-agent-test-'));
    
    // 创建文件
    for (const [relativePath, content] of Object.entries(files)) {
        const fullPath = join(dir, relativePath);
        const parentDir = dirname(fullPath);
        
        // 确保父目录存在
        if (!existsSync(parentDir)) {
            mkdirSync(parentDir, { recursive: true });
        }
        
        // 写入文件
        writeFileSync(fullPath, content, 'utf-8');
    }
    
    return dir;
}

/**
 * 清理测试工作区
 */
export function cleanupTestWorkspace(dir: string): void {
    if (dir && existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
    }
}