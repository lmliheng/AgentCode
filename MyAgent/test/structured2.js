/**
 * @test/structured2.js
 * 验证：
 * 1. thinking + jsonMode + 提示词含 json → withStructuredOutput 可用
 * 2. thinking + bindTools（tool_choice auto）→ 开发子图模式可用
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

console.log("=== 1. thinking + jsonMode + json 字样 ===");
{
  const schema = z.object({
    name: z.string(),
    count: z.number(),
    tags: z.array(z.string()),
  });
  try {
    const structured = model.withStructuredOutput(schema, { method: "jsonMode" });
    const res = await structured.invoke([
      new SystemMessage("严格按给定 JSON 结构输出，不要输出其他内容。"),
      new HumanMessage("我叫测试，数量 3，标签：a、b、c"),
    ]);
    check("jsonMode 成功", res.name && res.count === 3 && Array.isArray(res.tags));
    console.log(`   result: ${JSON.stringify(res)}`);
  } catch (e) {
    check("jsonMode 成功", false);
    console.log(`   err: ${e?.status} ${e?.message ?? e}`);
  }
}

console.log("=== 2. thinking + bindTools(auto) 开发子图模式 ===");
{
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
    new SystemMessage("需要计算时用 add 工具，最后用一句话回答结果。"),
    new HumanMessage("请计算 123 + 456 并告诉我结果。"),
  ];
  let loop = 0;
  let finalText = "";
  let usedTool = false;
  try {
    while (loop < 5) {
      loop++;
      const res = await bound.invoke(msgs);
      msgs.push(res);
      if (res.tool_calls?.length) {
        usedTool = true;
        const node = new ToolNode([addTool]);
        const out = await node.invoke({ messages: [res] });
        msgs.push(out.messages[0]);
      } else {
        finalText = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
        break;
      }
    }
    check("工具被调用", usedTool);
    check("循环完成拿到最终回答", finalText.length > 0);
    console.log(`   final: ${finalText.slice(0, 80)}`);
  } catch (e) {
    check("工具被调用", false);
    console.log(`   err: ${e?.status} ${e?.message ?? e}`);
  }
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
