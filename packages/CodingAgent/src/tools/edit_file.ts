// src/tools/edit-file.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Tool, ToolContext, ToolResult, ValidationResult, ToolParams } from '../types/Tool.js';

export interface EditFileParams extends ToolParams {
    path: string;
    old_string: string;
    new_string: string;
    expected_count?: number;
    dryRun?: boolean;
}

export class EditFileTool implements Tool<EditFileParams> {
    readonly name = 'edit_file';
    readonly description = `修改文件内容：把文件中的 old_string 替换为 new_string。

- 调用前必须先用 read_file 读取该文件，保证 old_string 与文件内容逐字一致（含缩进与空白）。
- old_string 要带足上下文（完整的一行或一整块）；只给 "}" 这类短片段容易匹配到别处，匹配不到或次数不符都会失败并回报实际匹配次数。
- 需要先看改动效果而不写盘时用 dryRun。
- 只做局部改动：整体重写文件用 create_file 并传 overwrite: true，移动用 move_file，删除用 delete_file。
- 参数与 apply_diff 相同，但本工具把 new_string 按字面量写入；不要在两者之间混用。`;
    readonly permissions = {
        readsFiles: true,
        writesFiles: true,
        runsShell: false,
        requiresApproval: true,  // 需要人工审批
    };

    validate(params: unknown): ValidationResult {
        const errors: string[] = [];
        if (typeof params !== 'object' || params === null) {
            return { valid: false, errors: ['参数必须是对象'], sanitized: params };
        }
        const p = params as Record<string, unknown>;
        if (typeof p.path !== 'string' || p.path.trim() === '') {
            errors.push('path 是必填字段，且必须是非空字符串');
        }
        if (typeof p.old_string !== 'string' || p.old_string.trim() === '') {
            errors.push('old_string 是必填字段，且必须是非空字符串');
        }
        if (typeof p.new_string !== 'string') {
            errors.push('new_string 是必填字段，且必须是字符串');
        }
        if (p.expected_count !== undefined && (!Number.isInteger(p.expected_count) || (p.expected_count as number) < 1)) {
            errors.push('expected_count 必须是正整数');
        }
        if (errors.length > 0) {
            return { valid: false, errors, sanitized: params };
        }
        const sanitized: EditFileParams = {
            path: (p.path as string).trim(),
            old_string: p.old_string as string,
            new_string: p.new_string as string,
            expected_count: (p.expected_count as number) ?? 1,
            dryRun: (p.dryRun as boolean) ?? false,
        };
        return { valid: true, errors: [], sanitized };
    }

    async execute(params: EditFileParams, ctx: ToolContext): Promise<ToolResult> {
        const fullPath = resolve(ctx.workspaceRoot, params.path);
        
        // 1. 读取文件
        let content: string;
        try {
            content = readFileSync(fullPath, 'utf-8');
        } catch (e: any) {
            return { success: false, data: null, error: `读取失败: ${e.message}` };
        }

        // 2. 统计匹配次数
        const matches = content.split(params.old_string).length - 1;
        if (matches === 0) {
            return { success: false, data: null, error: `在文件中未找到匹配的字符串: ${params.old_string.slice(0, 50)}` };
        }
        if (matches !== params.expected_count) {
            return {
                success: false,
                data: null,
                error: `匹配次数不匹配：期望 ${params.expected_count} 次，实际找到 ${matches} 次。请检查 old_string 是否唯一。`,
            };
        }

        // 3. 执行替换
        const newContent = content.replaceAll(params.old_string, params.new_string);
        
        // 4. 如果是 dryRun，只返回 diff
        if (params.dryRun) {
            return {
                success: true,
                data: {
                    path: params.path,
                    dryRun: true,
                    matches,
                    diff: this.generateDiff(params.path, content, newContent),
                },
            };
        }

        // 5. 写回文件
        try {
            writeFileSync(fullPath, newContent, 'utf-8');
        } catch (e: any) {
            return { success: false, data: null, error: `写入失败: ${e.message}` };
        }

        return {
            success: true,
            data: {
                path: params.path,
                matches,
                replaced: true,
                diff: this.generateDiff(params.path, content, newContent),
            },
        };
    }

    private generateDiff(path: string, oldContent: string, newContent: string): string {
        const oldLines = oldContent.split('\n');
        const newLines = newContent.split('\n');
        // 简化版 diff，实际项目用 diff 库
        return `--- a/${path}\n+++ b/${path}\n@@ -1,${oldLines.length} +1,${newLines.length} @@\n${newContent}`;
    }

    getSchema(): Record<string, unknown> {
        return {
            type: 'object',
            properties: {
                path: { type: 'string', description: '文件路径，相对于工作区根目录' },
                old_string: { type: 'string', description: '要被替换的旧字符串，需带足上下文以保证唯一匹配' },
                new_string: { type: 'string', description: '替换后的新字符串，按字面量写入（$ 不做特殊解释）' },
                expected_count: { type: 'integer', description: '期望的匹配次数（默认 1）', minimum: 1 },
                dryRun: { type: 'boolean', description: '是否仅做 dry-run，不实际写盘（默认 false）' },
            },
            required: ['path', 'old_string', 'new_string'],
        };
    }
}