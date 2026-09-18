// src/test-runtime.ts

import { DeepSeekProvider } from '../provider/deepseek.provider.js';
import { AgentRuntime } from '../runtime/agent.runtime.js';

async function main() {
    // 1. 创建 Provider
    const provider = new DeepSeekProvider({
        modelName: 'deepseek-chat',
        apiKey: process.env.DEEPSEEK_API_KEY!,
        baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    });

    // 2. 创建 Runtime（暂时没有工具，先测试核心循环）
    const runtime = new AgentRuntime(
        provider,
        [],  // 工具列表，后续添加
        {
            maxIterations: 10,
            timeoutMs: 60000,
        }
    );

    // 3. 执行任务
    const result = await runtime.run('修复 src/user.ts 中的类型错误');
    
    console.log('运行结果:', JSON.stringify(result, null, 2));
}

main().catch(console.error);