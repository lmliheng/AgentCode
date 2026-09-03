/**
 * @test/repro.js
 * 最小复现：jsonMode + thinking + 多行中文文档内容
 */
import { ChatDeepSeek } from "@langchain/deepseek";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

const PROJECT_DOC = `项目名称：TodoCLI
项目目标：开发一个 Node.js 命令行待办事项应用。
功能：
1. 添加待办：todo add "内容"
2. 列出待办：todo list
3. 删除待办：todo delete <id>
数据存储：JSON 文件（todos.json）。
技术栈：Node.js（ESM），无第三方依赖。`;

const schema = z.object({
  project_info: z.object({ name: z.string(), goal: z.string() }),
  feasible: z.boolean(),
});

const model = new ChatDeepSeek({
  model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
  modelKwargs: { thinking: { type: "enabled" } },
});

async function tryCase(label, systemText, humanText) {
  try {
    const structured = model.withStructuredOutput(schema, { method: "jsonMode" });
    const res = await structured.invoke([
      new SystemMessage(systemText),
      new HumanMessage(humanText),
    ]);
    console.log(`  ✅ ${label} → ${JSON.stringify(res).slice(0, 100)}`);
    return true;
  } catch (e) {
    console.log(`  ❌ ${label} → ${e?.status} ${String(e?.message ?? e).slice(0, 120)}`);
    return false;
  }
}

console.log("=== 逐步缩小触发点 ===");
await tryCase("完整文档", "严格按给定 JSON 结构输出。", PROJECT_DOC);
await tryCase("短文本", "严格按给定 JSON 结构输出。", "项目名称：TodoCLI，目标：命令行待办");
await tryCase("仅引号", "严格按给定 JSON 结构输出。", '添加待办：todo add "内容"');
await tryCase("仅尖括号", "严格按给定 JSON 结构输出。", "删除待办：todo delete <id>");

console.log("=== 复制 doc_understand 完整 system prompt ===");
const DOC_SYSTEM = `你是一名资深软件架构师。用户会给你一份项目需求文档。

你的任务：
1. 提取项目信息：名称、目标、技术栈、功能模块。
2. 评估可行性：文档描述的需求能否实现？是否存在矛盾、缺失关键信息、技术栈不可实现等严重问题？
3. 评估可靠性：文档对错误处理、边界情况、非功能性需求的覆盖程度如何？
4. 列出风险与严重问题（blockers）。

输出规则：
- 只输出一个 JSON 对象，字段名必须与下面结构完全一致（不要改名、不要增减字段）：
{
  "project_info": { "name": "项目名称", "goal": "项目目标", "tech_stack": ["技术栈"], "modules": ["功能模块"] },
  "feasibility": { "score": 0-10 之间的数字, "conclusion": "可行性结论" },
  "reliability": { "score": 0-10 之间的数字, "conclusion": "可靠性结论" },
  "risks": ["潜在风险"],
  "feasible": true 或 false,
  "blockers": ["严重问题；没有则为空数组"]
}
- feasible=false 仅当存在无法继续开发的严重问题；一般性疑问不算。`;
await tryCase("完整 system prompt + 文档", DOC_SYSTEM, PROJECT_DOC);
