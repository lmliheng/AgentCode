

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
     */
    decide(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ModelResponse>;

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
        prompt_cache_hit_tokens?: number
        prompt_cache_miss_tokens?: number
    }
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