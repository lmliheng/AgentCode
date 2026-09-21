// src/tools/read-file.ts

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Tool, ToolContext, ToolResult, ValidationResult, ToolParams } from '../types/Tool.js';

/**
 * read_file 的参数类型
 * start
 * end
 * maxChars
 */
export interface ReadFileParams extends ToolParams {
    path: string;
    start?: number;
    end?: number;
    maxChars?: number;
}

export class ReadFileTool implements Tool<ReadFileParams> {
    readonly name = 'read_file';
    readonly description = `读取文件内容。默认返回从第 1 行起的最多 200 行，且不超过 maxChars。

- 修改文件前先用本工具确认当前内容，不要凭记忆构造 old_string。
- path 是工作区内的相对路径；不要传绝对路径，传了会被当成相对路径拼在工作区根之后。
- 返回的 totalLines 是文件总行数；内容被截断时用 start/end 指定行区间分次读取。
- maxChars 上限 50000，但整体输出预算更小，放宽后仍可能被截断成「首尾保留」的片段。
- 要查某个字符串出现在哪些文件里，用 search_code，不要逐个文件读。`;
    readonly permissions = {
        readsFiles: true,
        writesFiles: false,
        runsShell: false,
        requiresApproval: false,
    };
    /**
     * 自身内容上限是 8000 字符 / 200 行，这里留出 JSON 信封的余量，
     * 使已按自身口径截断过的内容不会再被运行时兜底二次截断。
     */
    readonly outputBudget = { maxChars: 10000, maxLines: 300 };

    validate(params: unknown): ValidationResult {
        const errors: string[] = [];
        if (typeof params !== 'object' || params === null) {
            return { valid: false, errors: ['参数必须是对象'], sanitized: params };
        }
        const p = params as Record<string, unknown>;

        if (typeof p.path !== 'string' || p.path.trim() === '') {
            errors.push('path 是必填字段，且必须是非空字符串');
        }
        if (p.start !== undefined && (!Number.isInteger(p.start) || (p.start as number) < 1)) {
            errors.push('start 必须是正整数（从 1 开始）');
        }
        if (p.end !== undefined && (!Number.isInteger(p.end) || (p.end as number) < 1)) {
            errors.push('end 必须是正整数');
        }
        if (typeof p.start === 'number' && typeof p.end === 'number' && p.start > p.end) {
            errors.push('start 不能大于 end');
        }
        if (p.maxChars !== undefined && (!Number.isInteger(p.maxChars) || (p.maxChars as number) < 1)) {
            errors.push('maxChars 必须是正整数');
        }
        if (errors.length > 0) {
            return { valid: false, errors, sanitized: params };
        }
        const sanitized: ReadFileParams = {
            path: (p.path as string).trim(),
            start: p.start as number ?? undefined,
            end: p.end as number ?? undefined,
            maxChars: (p.maxChars as number) ?? 8000,
        };
        return { valid: true, errors: [], sanitized };
    }

    async execute(params: ReadFileParams, ctx: ToolContext): Promise<ToolResult> {
        const fullPath = resolve(ctx.workspaceRoot, params.path);
        let content: string;
        try {
            content = readFileSync(fullPath, 'utf-8');
        } catch (e: any) {
            return { success: false, data: null, error: `读取失败: ${e.message}` };
        }
        const lines = content.split('\n');
        const totalLines = lines.length;
        const start = params.start ?? 1;
        const end = params.end ?? Math.min(totalLines, start + 200 - 1);
        const slice = lines.slice(start - 1, end);
        let result = slice.join('\n');
        const maxChars = params.maxChars ?? 8000;
        const truncated = result.length > maxChars;
        if (truncated) {
            result = result.slice(0, maxChars) + '\n\n...（已截断）';
        }
        return {
            success: true,
            data: { path: params.path, start, end, totalLines, returnedLines: slice.length, truncated, content: result },
        };
    }

    getSchema(): Record<string, unknown> {
        return {
            type: 'object',
            properties: {
                path: { type: 'string', description: '文件路径，相对于工作区根目录' },
                start: { type: 'integer', description: '起始行号，从 1 开始（默认 1）', minimum: 1 },
                end: { type: 'integer', description: '结束行号，含该行（默认 start + 199）', minimum: 1 },
                maxChars: { type: 'integer', description: '限制返回的最大字符数（默认 8000）', minimum: 1, maximum: 50000 },
            },
            required: ['path'],
        };
    }
}