import type { AgentProvider, AgentProviderConfig } from '@lmliheng/acode-core'
import { DeepSeekProvider } from './deepseek.provider.js'
import { OpenAIProvider } from './openai.provider.js'

/**
 * 支持的 Provider 类型。
 *
 * `openai` 指的是**协议**（`/chat/completions`），不是某一家厂商：Moonshot、通义、
 * 智谱、本机的 Ollama / vLLM 都能用它，靠 `baseUrl` 指到对应端点即可。
 * anthropic 与 gemini 是另一套协议，尚未实现。
 */
export type ProviderType = 'openai' | 'deepseek';

/** 各家读取密钥的环境变量名。密钥不进配置文件，只从环境来 */
export const PROVIDER_API_KEY_ENV: Record<ProviderType, string> = {
    deepseek: 'DEEPSEEK_API_KEY',
    openai: 'OPENAI_API_KEY',
};

/**
 * 创建 Provider 实例的工厂函数
 */
export function createProvider(
    type: ProviderType,
    config: AgentProviderConfig
): AgentProvider {
    switch (type) {
        case 'openai':
            return new OpenAIProvider(config);
        case 'deepseek':
            return new DeepSeekProvider(config);
        default:
            throw new Error(`不支持的 Provider 类型：${type satisfies never}`);
    }
}