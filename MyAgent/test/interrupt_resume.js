/**
 * @test/interrupt_resume.js
 * 验证 LangGraph interrupt 的 resume 值格式：
 * 单 interrupt 时 resume 传值 vs 传数组，interrupt() 返回什么？
 */
import { StateGraph, START, END, MemorySaver, interrupt, Command, Annotation } from "@langchain/langgraph";

const S = Annotation.Root({
  doc: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
});

async function collect(state) {
  const v = interrupt({ kind: "collect_doc" });
  console.log("interrupt() 返回值：", JSON.stringify(v), "类型：", Array.isArray(v) ? "array" : typeof v);
  return { doc: v };
}

const builder = new StateGraph(S)
  .addNode("collect", collect)
  .addEdge(START, "collect")
  .addEdge("collect", END);
const graph = builder.compile({ checkpointer: new MemorySaver() });
const config = { configurable: { thread_id: "t1" } };

// 场景 A：resume 传数组（当前 e2e 的做法）
let r = await graph.invoke({}, config);
console.log("A: interrupt 存在：", !!r.__interrupt__);
r = await graph.invoke(new Command({ resume: ["项目文档内容"] }), config);
console.log("A: 最终 doc =", JSON.stringify(r.doc));

// 场景 B：resume 传值
const config2 = { configurable: { thread_id: "t2" } };
r = await graph.invoke({}, config2);
r = await graph.invoke(new Command({ resume: "项目文档内容" }), config2);
console.log("B: 最终 doc =", JSON.stringify(r.doc));
