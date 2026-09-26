import type { AgentProvider, AgentProviderConfig, ModelResponse, DeepSeekResponse } from '../types/AgentProvider.js'
import { DeepSeekProvider } from './deepseek.provider.js'
/**
 * 支持的 Provider 类型
 * openai,authropic,genmini
 */
export type ProviderType = 'openai' | 'deepseek';


/**
 * 创建 Provider 实例的工厂函数
 */
export function createProvider(
    type: ProviderType,
    config: AgentProviderConfig
): AgentProvider {
    switch (type) {
        case 'openai':
            throw new Error(`openai Provider 暂时不能使用`);
        // return new OpenAIProvider(config);
        case 'deepseek':
            return new DeepSeekProvider(config);
        default:
            throw new Error(`不支持的 Provider 类型：${type}`);
    }
}