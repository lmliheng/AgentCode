// src/test/ds.test.ts
//
// 手动冒烟脚本，不在 vitest 的收集范围内（见 vitest.config.ts）：
//   npm run test:ds -- <工作区路径>
//
// 它会发起真实模型调用，并且可能真的改动工作区里的文件。
// 请只对一次性副本运行，不要直接指向你正在编辑的工作树。
import { DeepSeekProvider } from '../provider/deepseek.provider.js';
import { AgentRuntime } from '../runtime/agent.runtime.js';
import { baseTools } from '../tools/index.js'

async function main() {
    const workspacePath = process.argv[2] ?? process.cwd();

    // 刻意不传 baseUrl：使用默认端点，同时覆盖该默认值
    const provider = new DeepSeekProvider({
        modelName: 'deepseek-chat',
        apiKey: process.env.DEEPSEEK_API_KEY!,
    });

    // 工具声明由运行时按注册的工具集合生成并随请求下发；
    // 调用方不再需要（也无法）手写工具格式。
    const runtime = new AgentRuntime(provider, [...baseTools()], {
        workspacePath,
        maxIterations: 100,
        timeoutMs: 60000,
    });

    const result = await runtime.run('在C:\Users\Lenovo\Desktop 下创建RAG目录，实现一个rag应用');

    console.log(JSON.stringify(result, null, 2))

    const succeeded = result.state.observations.filter(o => o.result.success);
    console.log('工作区:      ', workspacePath);
    console.log('停止原因:    ', JSON.stringify(result.state.stopReason));
    console.log('决策数:      ', result.state.decisions.length);
    console.log('成功观察数:  ', succeeded.length, '/', result.state.observations.length);
    console.log('累计用量:    ', JSON.stringify(result.state.tokenUsage));

    if (succeeded.length > 0) {
        console.log('首个成功观察:', JSON.stringify(succeeded[0]!.action.tool), JSON.stringify(succeeded[0]!.result.data).slice(0, 200));
    }

    console.log('验收结论:', JSON.stringify(result.verification, null, 2));
}

main().catch(console.error);
