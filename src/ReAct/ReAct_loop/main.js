import { createIncidentToolset } from './Tools.js'
import { getIncidentScenario } from './scenarios.js'
import { runReactAgent } from './ReActAgent.js'

const scenarioName = process.argv[2] || 'release-regression'

const goal =
    'payment-service 从 15:10 开始出现大量支付失败。请根据服务状态、监控、日志以及必要的关联信息，找出最可能的故障原因并给出处理建议。不要执行重启或回滚。'

/**
 * 启动当前故障场景。
 *
 * 场景名称只用于切换本地模拟数据，
 * 不会把预设的故障原因直接告诉模型。
 */
async function main() {
    const { tools, scenario, executeToolCall } =
        createIncidentToolset(scenarioName)
    console.log(`本地故障场景：${scenario.label}`)

    await runReactAgent({
        goal,
        tools,
        executeToolCall
    })
}

main().catch((error) => {
    console.error('\n运行失败：', error instanceof Error ? error.message : error)
    process.exitCode = 1
})
