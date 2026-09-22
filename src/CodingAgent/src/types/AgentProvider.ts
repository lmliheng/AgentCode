

import type { ChatMessage } from './Message.js'
import type { ModelDecision } from './ReAct.js'

/**
 * @api基本配置
 */
export interface AgentProviderConfig {
    modelName: string;
    apiKey?: string;
    baseUrl?: string;
    maxTokens?: number;
    temperature?: number;
    timeout?: number;
    /**
     * 是否请求流式响应，默认 true。
     *
     * 关掉它只是兜底：流式与整包响应在协议上是两条不同的路（SSE 分块 vs 一个
     * JSON），出问题时需要能退回已验证的那条。两条路产出的 `ModelResponse`
     * 完全相同，所以调用方不必知道自己走的是哪条。
     */
    stream?: boolean;
}


/**
 * @统一抽象tool定义
 * 具体模型在decide里自行转换对应tool模型
 */
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;  // JSON Schema
}


/**
 * 控制流入口的工具名。
 *
 * 它们不是可执行工具 —— 运行时不会执行、也不在工具注册表里 —— 而是让模型主动
 * 触发状态迁移的协议入口。声明与响应翻译由 Provider 负责；运行时的提示词需要引用
 * 它们，因此名字放在协议契约这一层，避免运行时反向依赖某个具体 Provider。
 */
export const REQUEST_REPLAN_TOOL = 'request_replan'
export const BATCH_TOOL = 'batch'


/**
 * 流式响应的单块增量。
 *
 * 只带增量文本，不带位置与序号：调用方拿到就直接写出去，不必知道 SSE 的分包边界
 * （一块可能只有半个汉字，也可能同时横跨多个字段）。
 *
 * 思考链与正文分开而不是合成一个字段 —— 它们在界面上是两个区域，合起来就还原不了。
 */
export interface StreamDelta {
    /** 正文增量（最终答复，或工具调用轮里的说明文字） */
    content?: string;
    /** 思考链增量（thinking 模式才有；deepseek-chat 通常不返回） */
    reasoningContent?: string;
}


/**
 * @统一抽象响应
 */
export interface ModelResponse {
    decision: ModelDecision;
    rawContent: string;
    reasoningContent?: string | null;
    finishReason?: string;
    modelName?: string;
    usage?: TokenUsage;
}



// 通用的用量类型
export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /**
     * 命中前缀缓存的输入 token 数。
     *
     * 省略（而不是填 0）表示响应没提供这个数 —— 「未命中」与「不知道」不能混同，
     * 混同会让「缓存一点没命中」和「缓存信息拿不到」在展示上长得一模一样。
     */
    cacheHitTokens?: number;
    /** 未命中前缀缓存的输入 token 数。省略的含义同上 */
    cacheMissTokens?: number;
    [key: string]: unknown;
}


/**
 * Agent Provider 的抽象接口
 * 
 * 所有具体的模型提供商 现在仅提供deepseek
 * 都需要实现这个接口
 */
export interface AgentProvider {
    /** 获取提供商的名称，用于日志和调试 */
    readonly name: string;

    /** 获取当前配置 */
    readonly config: AgentProviderConfig;

    /**
     * 发送消息给模型并获取结构化的决策
     * 加tools
     *
     * @param onDelta 增量回调。提供时，模型每产出一段正文或思考内容就回调一次。
     *   它是纯粹的旁路通知，不参与决策构造 —— 无论给不给，返回值都必须是完整的
     *   `ModelResponse`。所以「是否流式」由配置决定，不由这个回调有没有来决定，
     *   否则生产与测试会跑在两条不同的路上。
     */
    decide(
        messages: ChatMessage[],
        tools: ToolDefinition[],
        onDelta?: (delta: StreamDelta) => void,
    ): Promise<ModelResponse>;

    /**
     * 更新配置（运行时切换模型时使用）
     */
    updateConfig(config: Partial<AgentProviderConfig>): void;
}






/**
 * @deepseek类型接口
 */
export interface DeepSeekResponse {
    id: string
    object: 'chat.completion'
    created: number
    model: string
    system_fingerprint?: string
    choices: DeepSeekChoice[]
    usage: DeepSeekUsage
}
// 单个 choice
export interface DeepSeekChoice {
    index: number
    message: DeepSeekMessage // 这是我定义的
    finish_reason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'insufficient_system_resource' | 'aborted' | null
    logprobs?: null | {
        content: Array<{
            token: string
            logprob: number
            bytes: number[]
            top_logprobs: Array<{ token: string; logprob: number; bytes: number[] }>
        }>
    }
}
export interface DeepSeekUsage {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    // 提示词token消耗量细节
    prompt_tokens_details?: {
        cached_tokens?: number
    }
    /**
     * 前缀缓存命中 / 未命中的输入量。
     *
     * 实测（2026-09-22，deepseek-flash）与 `prompt_tokens_details.cached_tokens`
     * 同时返回、取值一致，且满足 hit + miss === prompt_tokens；命中按 64 token 的块
     * 对齐（输入 814 + 固定前缀，第二次命中 640）。
     */
    prompt_cache_hit_tokens?: number
    prompt_cache_miss_tokens?: number
    completion_tokens_details?: {
        reasoning_tokens?: number
    }
}
export interface DeepSeekMessage {
    role: 'assistant'
    content: string | null
    reasoning_content?: string | null // 思考内容
    tool_calls?: DeepSeekToolCall[]
}
export interface DeepSeekToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

/**
 * @deepseek 流式响应的单块（object: 'chat.completion.chunk'）
 *
 * 与非流式 `DeepSeekResponse` 的差别是两处：`choices[].message` 换成
 * `choices[].delta`，以及工具调用按 `index` 分片到达 —— `arguments` 是逐段
 * 拼起来的字符串，不能逐片 `JSON.parse`。
 */
export interface DeepSeekChunk {
    id?: string
    object: 'chat.completion.chunk'
    created?: number
    model?: string
    choices: DeepSeekChunkChoice[]
    /**
     * 用量只在最后一块到达。实测（2026-09-22，官方流式响应样例）DeepSeek
     * 默认就带，不需要像 OpenAI 那样显式传 `stream_options.include_usage`。
     */
    usage?: DeepSeekUsage
}

export interface DeepSeekChunkChoice {
    index: number
    delta: DeepSeekDelta
    finish_reason: DeepSeekChoice['finish_reason']
}

/** 增量块里的消息片段：除 tool_calls 外都是整值，只有它是碎的 */
export interface DeepSeekDelta {
    role?: 'assistant' | null
    content?: string | null
    reasoning_content?: string | null
    tool_calls?: DeepSeekDeltaToolCall[]
}

/**
 * 分片形态的工具调用。
 *
 * `index` 是把碎片拼回同一次调用的唯一依据。同一块里通常只有部分字段：
 * `arguments` 要一路累加，而 `id` / `name` 是整体赋值 —— 累加会在服务端重发
 * 整值时把名字拼重（照 openai-node 的 accumulateChatCompletion）。
 */
export interface DeepSeekDeltaToolCall {
    index: number
    id?: string
    type?: 'function'
    function?: {
        name?: string
        arguments?: string
    }
}
/**
 * @Tool定义类型
 */
export type DeepseekToolDefinition = {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: JsonSchemaObject
    };
}
export type JsonSchemaObject = {
    type: "object";
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
    additionalProperties?: boolean;
    description?: string;
}
export type JsonSchemaProperty = {
    type: "string" | "number" | "boolean" | "integer" | "array" | "object";
    description?: string;
    enum?: string[];
    items?: JsonSchemaProperty;  // 如果是 array
    properties?: Record<string, JsonSchemaProperty>;  // 如果是嵌套 object
    required?: string[];
}