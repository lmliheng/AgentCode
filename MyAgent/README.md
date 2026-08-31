### 一个简化的 agent coding 

使用LangGraph完成ReActLoop，适配MCP，RAG。

设计：
首先使用langgraph相比langchain可扩展性强，因为这里的Agent要完成的任务并不简单，其中有工作目录选择，文件读取，长期记忆，Plan-and-Execute，所以我选择langgraph。暂时不使用DeepAgentSdk。现在分析一下的Agent工作流程，1. Agent提问用户，让用户提供项目文档。 2. 拿到文档，分析可行性，可靠性，分析文档里的遗漏点，反问用户让用户选择遗漏点部分的设计(3个选择，1个自定义) 3. 等到信息完整后，开始开发，在完成一个功能后，将功能
信息反馈给用户。 

节点：
1文档理解节点
```

```


2遗漏分析节点
```
{
  "missing_points": [
    {
      "module": "auth",
      "question": "是否支持 OAuth2？",
      "options": [
        "支持",
        "不支持",
        "仅支持 JWT",
        "自定义"
      ]
    }
  ]
}
```
3Plan-and-Execute 节点


4开发节点
```
{
  "task_id": "T01",
  "module": "auth",
  "goal": "实现 JWT 登录",
  "inputs": [...],
  "outputs": [...],
  "core_files": [...],
  "acceptance_criteria": [...]
}
```

5反馈节点

```
功能完成
模块：auth
文件：
- auth/jwt.py
- auth/models.py

核心代码：
...

测试：
...

是否继续？ [Y / 修改 / 终止]
```