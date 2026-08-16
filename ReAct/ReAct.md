Reasoning + Acting = ReAct。原始论文想解决的问题是：模型不能只坐在那里推理，也不能只会机械执行动作。它需要 一边判断当前情况，一边与外部环境交互。环境返回新的信息以后，模型再更新判断，继续执行。也就是现在Toolcalling的过程

AI 通过当前的observation决定下一次的action，如果observation显示不再需要下一步action就直接结束
这就是一个ReAct Loop。Action 表示 Agent 当前决定执行的动作，Observation 表示 Action 执行以后，外部环境返回的真实结果。

和ToolCalling不一样的是工具返回Observation


1. 在用户提问AI思考解决流程 这个过程叫 `Plan-and-Execute生成计划(可执行步骤)`。
2. 根据`AI 通过当前的observation决定下一次的action` AI可能会修改之前的计划，`Replanning重新规划`
3. 这个计划清单不能用自然语言保存，当前项目会把任务目标、完成条件、计划版本、步骤状态和 Observation 保存成一份结构化数据。咱们把这份数据叫作 `Plan State`
```json
{
    "goal": "排查 payment-service 支付失败",
    "version": 2,
    "status": "active",
    "completionCriteria": [
        "确认故障现象和异常时间",
        "找到直接故障表现",
        "使用独立数据验证故障原因"
    ],
    "steps": [
        {
            "id": "step-1",
            "toolName": "query_metrics",
            "dependsOn": [],
            "status": "completed",
            "observation": "数据库连接池使用率 46%"
        },
        {
            "id": "step-2",
            "toolName": "inspect_database_pool",
            "dependsOn": ["step-1"],
            "status": "cancelled",
            "observation": null
        }
    ]
}

```