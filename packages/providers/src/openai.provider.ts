// src/openai.provider.ts
//
// OpenAI 兼容端点。原来这里是空骨架（一个被注释掉的 class），于是「切换提供方」
// 实际上只有 DeepSeek 一条路。
//
// 实现为什么是继承而不是重写：`/chat/completions` 这一层协议是共同的 ——
// 消息翻译、工具声明的下发、tool_calls 的解析、SSE 增量拼接，OpenAI 与 DeepSeek
// 走的是同一套。真正不同的只有三样：端点、密钥的环境变量名、报错里那个厂商标。
// 把整份 600 行复制一遍，等于以后每修一个分片解析的 bug 都要修两处。
//
// 顺带解决一个更大的问题：凡是用这套协议的端点都能直接接进来 ——
// Moonshot、通义、智谱、以及本机的 Ollama / vLLM，只要把 baseUrl 指过去。

import type { AgentProviderConfig } from '@lmliheng/acode-core'
import { DeepSeekProvider } from './deepseek.provider.js'

/** 未显式配置 baseUrl 时使用的默认端点 */
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1/chat/completions'

export class OpenAIProvider extends DeepSeekProvider {
    override readonly name: string = 'openai'
    protected override readonly vendor: string = 'OpenAI'

    constructor(config: AgentProviderConfig) {
        // 默认端点写在默认值之前，config 里给了 baseUrl 就按调用方的来 ——
        // 换成本机 vLLM（http://localhost:8000/v1/chat/completions）靠的就是这个
        super({ baseUrl: DEFAULT_OPENAI_BASE_URL, ...config })
    }
}
