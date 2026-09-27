// src/tools/read_directory.ts


/**
 * 
 * 需要忽略node_modules
 */
import { readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import type{ Tool, ToolParams, ToolContext, ToolResult, ValidationResult } from '../types/Tool.js';

interface ReadDirectoryParams extends ToolParams {
    path?: string;             // 目录路径，默认工作区根目录
    maxDepth?: number;         // 最大深度，默认 1（仅当前层）
    showHidden?: boolean;      // 是否显示隐藏文件，默认 false
    maxItems?: number;         // 最大条目数，默认 500
}

interface DirEntry {
    name: string;
    path: string;
    type: 'file' | 'directory';
    size?: number;
    children?: DirEntry[];     // 仅目录有此字段
}

/**
 * 遍历过程中的计数，由 readDirRecursive 就地累加。
 *
 * 这些数字必须在这里数：`data.total` 只是起始目录的**顶层**条目数，
 * 报不出「这个目录下多少个文件」；而 maxItems 撑满这件事在返回值里毫无痕迹。
 */
interface DirectoryWalkState {
    /** 已计入的条目数，用于 maxItems 判满 */
    count: number;
    files: number;
    directories: number;
}

export class ReadDirectoryTool implements Tool<ReadDirectoryParams> {
    name = 'read_directory';
    description = `读取目录结构，返回树形层级信息；需要按文件名筛选或要扁平列表时用 list_files，两者不要同时调用。

- 本工具不会跳过 node_modules，且 maxItems 是全树累计计数：从工作区根展开深层目录容易被 node_modules 占满配额，建议把 path 指到具体子目录。
- 超出 maxItems 的条目不会出现在结果里。
- 返回项中的 path 是相对工作区根的路径，可直接作为其他工具的 path 参数。`;
    
    permissions = {
        readsFiles: true,
        writesFiles: false,
        runsShell: false,
        requiresApproval: false,
    };
    /**
     * maxItems 只限条目数，且返回的是嵌套树（每项还带 path/size），
     * 体积仍然不定 —— 这里补上字符与行数两个维度。
     */
    outputBudget = { maxChars: 12000, maxLines: 400 };

    getSchema() {
        return {
            type: 'object',
            properties: {
                path: { type: 'string', description: '目录路径（工作区内相对路径，默认为工作区根目录）' },
                maxDepth: { type: 'number', description: '最大展开深度，默认 1（仅当前层）', minimum: 1 },
                showHidden: { type: 'boolean', description: '是否包含以 . 开头的条目（默认 false）' },
                maxItems: { type: 'number', description: '最大条目数（默认 500）', minimum: 1 },
            },
        };
    }

    validate(params: unknown): ValidationResult {
        if (!params || typeof params !== 'object') {
            return { valid: false, errors: ['参数必须是对象'], sanitized: {} as ReadDirectoryParams };
        }

        const p = params as Record<string, unknown>;
        const errors: string[] = [];

        if (p.maxDepth !== undefined && (typeof p.maxDepth !== 'number' || p.maxDepth < 1)) {
            errors.push('maxDepth 必须是大于等于 1 的数字');
        }

        if (p.maxItems !== undefined && (typeof p.maxItems !== 'number' || p.maxItems < 1)) {
            errors.push('maxItems 必须是大于 0 的数字');
        }

        if (errors.length > 0) {
            return { valid: false, errors, sanitized: {} as ReadDirectoryParams };
        }

        return {
            valid: true,
            errors: [],
            sanitized: {
                path: p.path as string | undefined,
                maxDepth: p.maxDepth ?? 1,
                showHidden: p.showHidden === true,
                maxItems: p.maxItems ?? 500,
            },
        };
    }

    async execute(params: ReadDirectoryParams, ctx: ToolContext): Promise<ToolResult> {
        try {
            const startPath = params.path
                ? resolve(join(ctx.workspaceRoot, params.path))
                : resolve(ctx.workspaceRoot);

            // 安全检查
            const allowed = ctx.allowedPaths.some(p => startPath.startsWith(resolve(p)));
            if (!allowed) {
                return {
                    success: false,
                    data: null,
                    error: `路径 ${params.path || '.'} 不在允许的工作区内`,
                };
            }

            const state: DirectoryWalkState = {
                count: 0,
                files: 0,
                directories: 0,
            };
            const root = this.readDirRecursive(
                startPath,
                ctx.workspaceRoot,
                0,
                params.maxDepth ?? 1,
                params.showHidden ?? false,
                params.maxItems ?? 500,
                state
            );

            if (!root) {
                return {
                    success: false,
                    data: null,
                    error: '无法读取目录',
                };
            }

            const basePath = params.path || '.';
            // 判满口径与 list_files / search_code 一致（`>=`）。它偏保守：树里恰好
            // 有 maxItems 个条目时并没有东西被丢掉，此时仍会标注。要做到精确，得把
            // 预算检查挪到隐藏文件过滤之后、还要处理空子目录等情形 —— 不值得，而且
            // 三个工具用不同口径比偶尔多标一个"可能"更糟。措辞因此不说满。
            const truncated = state.count >= (params.maxItems ?? 500);

            return {
                success: true,
                data: {
                    path: basePath,
                    structure: root,
                    total: root.children?.length ?? 0,
                },
                display: `${basePath} / ${state.files} 个文件、${state.directories} 个目录`
                    + (truncated ? '（已达上限，可能未列全）' : ''),
            };
        } catch (err) {
            return {
                success: false,
                data: null,
                error: `读取目录失败: ${(err as Error).message}`,
            };
        }
    }

    private readDirRecursive(
        dirPath: string,
        rootPath: string,
        currentDepth: number,
        maxDepth: number,
        showHidden: boolean,
        maxItems: number,
        state: DirectoryWalkState
    ): DirEntry | null {
        if (state.count >= maxItems) return null;

        try {
            const items = readdirSync(dirPath);
            const entry: DirEntry = {
                name: relative(rootPath, dirPath) || '.',
                path: relative(rootPath, dirPath).replace(/\\/g, '/') || '.',
                type: 'directory',
                children: [],
            };

            for (const item of items) {
                if (state.count >= maxItems) break;

                // 隐藏文件过滤
                if (!showHidden && item.startsWith('.')) continue;

                const fullPath = join(dirPath, item);
                const relPath = relative(rootPath, fullPath).replace(/\\/g, '/');

                try {
                    const stats = statSync(fullPath);

                    if (stats.isDirectory()) {
                        const childEntry: DirEntry = {
                            name: item,
                            path: relPath,
                            type: 'directory',
                        };

                        if (currentDepth < maxDepth) {
                            const subChildren = this.readDirRecursive(
                                fullPath,
                                rootPath,
                                currentDepth + 1,
                                maxDepth,
                                showHidden,
                                maxItems,
                                state
                            );
                            if (subChildren) {
                                childEntry.children = subChildren.children!;
                            }
                        }

                        entry.children!.push(childEntry);
                        state.count++;
                        state.directories++;
                    } else if (stats.isFile()) {
                        entry.children!.push({
                            name: item,
                            path: relPath,
                            type: 'file',
                            size: stats.size,
                        });
                        state.count++;
                        state.files++;
                    }
                } catch {
                    continue;
                }
            }

            return entry;
        } catch {
            return null;
        }
    }
}