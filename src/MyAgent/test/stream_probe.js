/**
 * @test/stream_probe.js
 * 验证 graph.stream() + interrupt 的行为：
 * 1. streamMode="updates" 的 chunk 结构
 * 2. interrupt 时 stream 如何结束、resume 如何继续
 * 3. get_state / get_state_history 查看快照
 */
import { StateGraph, START, END, MemorySaver, interrupt, Command, Annotation } from "@langchain/langgraph";

const S = Annotation.Root({
  count: Annotation({ reducer: (x, y) => y ?? x, default: () => 0 }),
  note: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
});

async function nodeA(state) {
  console.log("  [nodeA 执行中]");
  return { count: (state.count ?? 0) + 1 };
}

async function nodeAsk(state) {
  const answer = interrupt({ kind: "ask" });
  return { note: answer };
}

async function nodeB(state) {
  console.log("  [nodeB 执行中]");
  return { count: (state.count ?? 0) + 10 };
}

const builder = new StateGraph(S)
  .addNode("nodeA", nodeA)
  .addNode("nodeAsk", nodeAsk)
  .addNode("nodeB", nodeB)
  .addEdge(START, "nodeA")
  .addEdge("nodeA", "nodeAsk")
  .addEdge("nodeAsk", "nodeB")
  .addEdge("nodeB", END);

const graph = builder.compile({ checkpointer: new MemorySaver() });
const config = { configurable: { thread_id: "probe" } };

console.log("=== 1. stream(updates) 第一次执行 ===");
let stream = await graph.stream({}, { ...config, streamMode: "updates" });
for await (const chunk of stream) {
  console.log("  chunk:", JSON.stringify(chunk));
  if (chunk.__interrupt__) {
    console.log("  → 遇到 interrupt，stream 结束");
  }
}

console.log("\n=== 2. get_state 查看中断时的快照 ===");
const snap = await graph.getState(config);
console.log("  values:", JSON.stringify(snap.values));

console.log("\n=== 3. resume 继续 stream ===");
stream = await graph.stream(new Command({ resume: "用户答案" }), { ...config, streamMode: "updates" });
for await (const chunk of stream) {
  console.log("  chunk:", JSON.stringify(chunk));
}

console.log("\n=== 4. get_state_history 查看全部快照 ===");
for await (const h of await graph.getStateHistory(config)) {
  console.log(
    `  step: ${h.step}  node: ${h.next?.join(",") ?? "?"}  values: ${JSON.stringify(h.values)}`
  );
}
