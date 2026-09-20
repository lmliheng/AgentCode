// src/tools/fetch_url.ts

import type { Tool, ToolParams, ToolContext, ToolResult, ValidationResult } from '../types/Tool.js';

interface FetchUrlParams extends ToolParams {
    url: string;               // 请求 URL
    method?: 'GET' | 'HEAD';   // HTTP 方法，默认 GET
    timeout?: number;          // 超时时间（毫秒），默认 15000
    headers?: Record<string, string>;  // 自定义请求头
}

export class FetchUrlTool implements Tool<FetchUrlParams> {
    name = 'fetch_url';
    description = '获取远程 URL 内容，支持 GET/HEAD 请求';

    permissions = {
        readsFiles: false,
        writesFiles: false,
        runsShell: false,
        requiresApproval: true,
    };
    /**
     * 抓回的正文按体积设上下文预算；工具内的 MAX_BODY_SIZE 只作内存防护，
     * 两者口径不同，不再用同一个数字兼顾。
     */
    outputBudget = { maxChars: 30000, maxLines: 800 };

    getSchema() {
        return {
            type: 'object',
            properties: {
                url: { type: 'string', description: '请求的 URL' },
                method: { type: 'string', enum: ['GET', 'HEAD'], description: 'HTTP 方法' },
                timeout: { type: 'number', description: '超时时间（毫秒）' },
                headers: { type: 'object', description: '自定义请求头' },
            },
            required: ['url'],
        };
    }

    validate(params: unknown): ValidationResult {
        if (!params || typeof params !== 'object') {
            return { valid: false, errors: ['参数必须是对象'], sanitized: {} as FetchUrlParams };
        }

        const p = params as Record<string, unknown>;
        const errors: string[] = [];

        if (!p.url || typeof p.url !== 'string' || p.url.trim() === '') {
            errors.push('url 是必填字段，且必须是非空字符串');
        }

        // URL 格式校验
        if (typeof p.url === 'string' && p.url.trim()) {
            try {
                const parsed = new URL(p.url);
                if (!['http:', 'https:'].includes(parsed.protocol)) {
                    errors.push('只支持 http:// 和 https:// 协议');
                }
            } catch {
                errors.push('URL 格式不正确');
            }
        }

        if (p.method !== undefined && !['GET', 'HEAD'].includes(p.method as string)) {
            errors.push('method 必须是 GET 或 HEAD');
        }

        if (p.timeout !== undefined && (typeof p.timeout !== 'number' || p.timeout < 1000 || p.timeout > 60000)) {
            errors.push('timeout 必须在 1000-60000 毫秒之间');
        }

        if (p.headers !== undefined && (typeof p.headers !== 'object' || Array.isArray(p.headers))) {
            errors.push('headers 必须是对象');
        }

        if (errors.length > 0) {
            return { valid: false, errors, sanitized: {} as FetchUrlParams };
        }

        return {
            valid: true,
            errors: [],
            sanitized: {
                url: (p.url as string).trim(),
                method: (p.method as 'GET' | 'HEAD') ?? 'GET',
                timeout: p.timeout ?? 15000,
                headers: p.headers as Record<string, string> | undefined,
            },
        };
    }

    async execute(params: FetchUrlParams, ctx: ToolContext): Promise<ToolResult> {
        try {
            // 请求确认
            const approval = await ctx.requestApproval({
                id: `${ctx.runId}-fetch-${Date.now()}`,
                runId: ctx.runId,
                createdAt: Date.now(),
                source: {
                    thought: `需要获取 URL: ${params.url}`,
                    decision: {
                        type: 'Action',
                        tool: 'fetch_url',
                        params: params as unknown as Record<string, unknown>,
                    },
                    contextSnapshot: {
                        currentPlan: '获取远程内容',
                        recentHistory: '',
                        currentStep: 'fetch_url',
                    },
                },
                preview: {
                    tool: 'fetch_url',
                    summary: `获取 ${params.url}`,
                    affectedFiles: [],
                    riskLevel: 'low',
                },
                status: 'pending',
                expiresAt: Date.now() + 5 * 60 * 1000,
            });

            if (approval !== 'approve') {
                return {
                    success: false,
                    data: null,
                    error: '用户取消了网络请求',
                };
            }

            // 使用 fetch API
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), params.timeout ?? 15000);

            try {
                const response = await fetch(params.url, {
                    method: params.method ?? 'GET',
                    signal: controller.signal,
                    headers: {
                        'User-Agent': 'AI-Coding-Agent/1.0',
                        ...params.headers,
                    },
                    
                });

                clearTimeout(timeoutId);

                const contentType = response.headers.get('content-type') || '';
                const isText = contentType.includes('text') ||
                    contentType.includes('json') ||
                    contentType.includes('javascript') ||
                    contentType.includes('xml') ||
                    contentType.includes('yaml');

                let body: string;
                if (isText) {
                    body = await response.text();
                } else {
                    body = `[Binary content: ${contentType}]`;
                }

                // 限制返回体大小
                const MAX_BODY_SIZE = 512 * 1024; // 512KB
                if (body.length > MAX_BODY_SIZE) {
                    body = body.substring(0, MAX_BODY_SIZE) + `\n\n... [截断，共 ${body.length} 字节]`;
                }

                return {
                    success: response.ok,
                    data: {
                        url: params.url,
                        status: response.status,
                        statusText: response.statusText,
                        headers: Object.fromEntries(response.headers.entries()),
                        contentType,
                        body,
                        size: body.length,
                    },
                    error: response.ok ? '' : `HTTP ${response.status}: ${response.statusText}`,
                };
            } finally {
                clearTimeout(timeoutId);
            }
        } catch (err: any) {
            if (err.name === 'AbortError') {
                return {
                    success: false,
                    data: null,
                    error: `请求超时（${params.timeout ?? 15000}ms）`,
                };
            }
            return {
                success: false,
                data: null,
                error: `请求失败: ${(err as Error).message}`,
            };
        }
    }
}