/**
 * @test/api.js
 * API 连通性验证：ChatDeepSeek 基础调用、withStructuredOutput、
 * bindTools 工具调用、thinking 透传（modelKwargs）。
 *
 * 运行：node --env-file=../.env test/api.js
 */
import { ChatDeepSeek } from "@langchain/deepseek";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { z } from "zod";

const model = new ChatDeepSeek({
  model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
  modelKwargs: { thinking: { type: "enabled" } },
});

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}`);
  }
}

// 1. 基础对话
console.log("=== 1. 基础对话 ===");
const r1 = await model.invoke("用一句话回答：1+1 等于几？");
check("invoke 返回内容", typeof r1.content === "string" && r1.content.length > 0);
console.log(`   content: ${String(r1.content).slice(0, 80)}`);

// 2. withStructuredOutput
console.log("=== 2. withStructuredOutput ===");
const schema = z.object({
  name: z.string(),
  count: z.number(),
  tags: z.array(z.string()),
});
const structured = model.withStructuredOutput(schema, { name: "test_out" });
const r2 = await structured.invoke("我叫测试，数量 3，标签：a、b、c");
check("结构化输出合法", r2.name && r2.count === 3 && Array.isArray(r2.tags));
console.log(`   result: ${JSON.stringify(r2)}`);

// 3. bindTools + ToolNode
console.log("=== 3. 工具调用 ===");
const addTool = tool(
  async ({ a, b }) => `和是 ${a + b}`,
  {
    name: "add",
    description: "计算两个整数之和",
    schema: z.object({ a: z.number(), b: z.number() }),
  }
);
const bound = model.bindTools([addTool]);
const msgs = [
  new SystemMessage("用工具计算，最后用一句话回答结果。"),
  new HumanMessage("请计算 123 + 456 并告诉我结果。"),
];
let loop = 0;
let finalText = "";
while (loop < 5) {
  loop++;
  const res = await bound.invoke(msgs);
  msgs.push(res);
  if (res.tool_calls?.length) {
    const node = new ToolNode([addTool]);
    const out = await node.invoke({ messages: [res] });
    msgs.push(out.messages[0]);
  } else {
    finalText = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
    break;
  }
}
check("工具调用循环完成", finalText.length > 0);
console.log(`   final: ${finalText.slice(0, 80)}`);

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
