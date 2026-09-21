// src/tools/apply_diff.ts

import { readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import type{ Tool, ToolParams, ToolContext, ToolResult, ValidationResult } from '../types/Tool.js';

interface ApplyDiffParams extends ToolParams {
    path: string;              // 要修改的文件路径
    old_string: string;        // 要被替换的旧字符串
    new_string: string;        // 替换后的新字符串
    expected_count?: number;   // 期望的匹配次数（用于唯一性校验）
}

export class ApplyDiffTool implements Tool<ApplyDiffParams> {
    name = 'apply_diff';
    description = `对文件应用字符串替换；与 edit_file 功能重叠，改动文件请优先用 edit_file。

- 不接受 unified diff / patch 格式的输入，参数是 old_string/new_string 纯字符串替换。
- 匹配次数不符时失败并回报实际匹配次数；调用前先用 read_file 确认待替换的内容。
- new_string 里的 $&、$1 会被当作替换模式解释；含这些片段的代码请改用 edit_file。`;
    
    permissions = {
        readsFiles: true,
        writesFiles: true,
        runsShell: false,
        requiresApproval: true,
    };

    getSchema() {
        return {
            type: 'object',
            properties: {
                path: { type: 'string', description: '要修改的文件路径（工作区内相对路径）' },
                old_string: { type: 'string', description: '要被替换的旧字符串，默认要求全文件唯一匹配' },
                new_string: { type: 'string', description: '替换后的新字符串；其中的 $& / $1 会被当作替换模式解释' },
                expected_count: { type: 'number', description: '期望的匹配次数（默认 1）', minimum: 1 },
            },
            required: ['path', 'old_string', 'new_string'],
        };
    }

    validate(params: unknown): ValidationResult {
        if (!params || typeof params !== 'object') {
            return { valid: false, errors: ['参数必须是对象'], sanitized: {} as ApplyDiffParams };
        }

        const p = params as Record<string, unknown>;
        const errors: string[] = [];

        if (!p.path || typeof p.path !== 'string' || p.path.trim() === '') {
            errors.push('path 是必填字段，且必须是非空字符串');
        }

        if (!p.old_string || typeof p.old_string !== 'string') {
            errors.push('old_string 是必填字段，且必须是字符串');
        }

        if (p.new_string === undefined || typeof p.new_string !== 'string') {
            errors.push('new_string 是必填字段，且必须是字符串');
        }

        if (p.expected_count !== undefined && (typeof p.expected_count !== 'number' || p.expected_count < 1)) {
            errors.push('expected_count 必须是大于 0 的数字');
        }

        if (errors.length > 0) {
            return { valid: false, errors, sanitized: {} as ApplyDiffParams };
        }

        return {
            valid: true,
            errors: [],
            sanitized: {
                path: (p.path as string).trim().replace(/\\/g, '/'),
                old_string: p.old_string as string,
                new_string: p.new_string as string,
                expected_count: p.expected_count as number | undefined,
            },
        };
    }

    async execute(params: ApplyDiffParams, ctx: ToolContext): Promise<ToolResult> {
        try {
            const filePath = resolve(join(ctx.workspaceRoot, params.path));

            // 安全检查
            const allowed = ctx.allowedPaths.some(p => filePath.startsWith(resolve(p)));
            if (!allowed) {
                return {
                    success: false,
                    data: null,
                    error: `路径 ${params.path} 不在允许的工作区内`,
                };
            }

            // 读取文件
            const content = readFileSync(filePath, 'utf-8');

            // 计算匹配次数
            const escapedOld = params.old_string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escapedOld, 'g');
            const matches = content.match(regex);
            const matchCount = matches ? matches.length : 0;

            const expectedCount = params.expected_count ?? 1;

            // 唯一性校验
            if (matchCount === 0) {
                return {
                    success: false,
                    data: null,
                    error: `在 ${params.path} 中未找到匹配的内容`,
                };
            }

            if (matchCount !== expectedCount) {
                return {
                    success: false,
                    data: null,
                    error: `期望匹配 ${expectedCount} 次，实际找到 ${matchCount} 次。请检查 old_string 的唯一性或设置准确的 expected_count`,
                };
            }

            // 执行替换
            const newContent = content.replace(regex, params.new_string);

            // 请求确认
            const approval = await ctx.requestApproval({
                id: `${ctx.runId}-diff-${Date.now()}`,
                runId: ctx.runId,
                createdAt: Date.now(),
                source: {
                    thought: `需要对 ${params.path} 应用 diff`,
                    decision: {
                        type: 'Action',
                        tool: 'apply_diff',
                        params: params as unknown as Record<string, unknown>,
                    },
                    contextSnapshot: {
                        currentPlan: '修改文件',
                        recentHistory: '',
                        currentStep: 'apply_diff',
                    },
                },
                preview: {
                    tool: 'apply_diff',
                    summary: `修改 ${params.path}（替换 ${matchCount} 处）`,
                    affectedFiles: [{
                        path: params.path,
                        changeType: 'modify',
                        diffPreview: `--- old\n+++ new\n@@ -1 +1 @@\n-${params.old_string}\n+${params.new_string}`,
                    }],
                    riskLevel: 'medium',
                },
                status: 'pending',
                expiresAt: Date.now() + 5 * 60 * 1000,
            });

            if (approval !== 'approve') {
                return {
                    success: false,
                    data: null,
                    error: '用户取消了修改操作',
                };
            }

            // 写入文件
            writeFileSync(filePath, newContent, 'utf-8');

            return {
                success: true,
                data: {
                    path: params.path,
                    replacements: matchCount,
                    old_length: params.old_string.length,
                    new_length: params.new_string.length,
                },
            };
        } catch (err) {
            return {
                success: false,
                data: null,
                error: `应用 diff 失败: ${(err as Error).message}`,
            };
        }
    }
}