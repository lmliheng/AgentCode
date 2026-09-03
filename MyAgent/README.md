# CodingAgent（MyAgent）

基于 **LangGraph** 的简化 CodingAgent：`项目理解 → 遗漏分析 → Plan-and-Execute → 开发 → 反馈`。

## 架构

```
┌─────────────────── 外层图（CodingAgentState）───────────────────┐
│  START → collect_doc(interrupt: 粘贴文档)                        │
│        → doc_understand(LLM: 信息+可行性/可靠性分析)              │
│        → [feasible=false] → feasibility_gate(interrupt: 继续/补文档/终止) │
│        → missing_analysis(LLM: 遗漏数组)                         │
│        → [有遗漏 且 轮数<3] → ask_missing(interrupt 逐个问) → 循环 │
│        → plan_tasks(LLM: 生成任务队列)                            │
│        → develop(内嵌 ReAct 子图) → feedback_loop(interrupt)     │
│             Y→下一任务 / MODIFY→带上下文重跑 / TERMINATE→END       │
└────────────────────────────────────────────────────────────────┘
        ┌────────── 内层 ReAct 子图（DevState）──────────┐
        │  agent(bindTools(fs工具)) → tools(ToolNode) → 循环 │
        │  step 计数，条件边限 15 步                        │
        └────────────────────────────────────────────────┘
```

## 模拟运行

不使用**--debug**模式，在index.js里会直接进行图的graph 使用一个固定名的thread，
当第一个interrupt出现，进入while(res.interrupt)循环，... 在查漏处中断，出现第一个
interrupt，**出现重复的遗漏点**
