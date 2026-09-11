/**
 * @test/structured.js
 * 探测 DeepSeek thinking 模式下可用的结构化输出方法。
 * withStructuredOutput 支持 method: 'functionCalling' | 'jsonMode' | 'jsonSchema'
 */
import { ChatDeepSeek } from "@langchain/deepseek";
import { z } from "zod";

const schema = z.object({
  name: z.string(),
  count: z.number(),
  tags: z.array(z.string()),
});

async function tryMethod(method) {
  const model = new ChatDeepSeek({
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    modelKwargs: { thinking: { type: "enabled" } },
  });
  try {
    const structured = model.withStructuredOutput(schema, { method });
    const res = await structured.invoke("我叫测试，数量 3，标签：a、b、c");
    console.log(`  ✅ method=${method} → ${JSON.stringify(res)}`);
    return true;
  } catch (e) {
    console.log(`  ❌ method=${method} → ${e?.status} ${e?.message ?? e}`);
    return false;
  }
}

console.log("=== thinking ON 下结构化输出方法探测 ===");
const results = {};
results.functionCalling = await tryMethod("functionCalling");
results.jsonMode = await tryMethod("jsonMode");
results.jsonSchema = await tryMethod("jsonSchema");

console.log("\n=== thinking OFF 对照（jsonMode）===");
{
  const model = new ChatDeepSeek({ model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash" });
  try {
    const structured = model.withStructuredOutput(schema, { method: "jsonMode" });
    const res = await structured.invoke("我叫测试，数量 3，标签：a、b、c");
    console.log(`  ✅ thinking off + jsonMode → ${JSON.stringify(res)}`);
    results.offJsonMode = true;
  } catch (e) {
    console.log(`  ❌ thinking off + jsonMode → ${e?.status} ${e?.message ?? e}`);
    results.offJsonMode = false;
  }
}

console.log("\n可用组合：", JSON.stringify(results));
