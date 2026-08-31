/**
 * @index.js
 * CodingAgent CLI 入口（决策 1：终端交互式）
 *
 * 启动流程：
 *   1. 询问工作目录（回车默认 ./workspace，决策 9）
 *   2. 若工作目录存在记忆（memory.json），询问是否加载继续（决策 12）
 *   3. 编译图（MemorySaver），初始 invoke
 *   4. 循环处理 interrupt：展示 → 收输入 → Command({ resume }) 恢复
 *   5. 结束后存档 memory.json
 *
 * 运行：node --env-file=.env index.js（或从仓库根 npm run agent）
 */
import { Command } from "@langchain/langgraph";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph } from "./graph.js";
import { createInterruptUI } from "./cli/interrupt_ui.js";
import { saveMemory, loadMemory, pickMemory } from "./memory.js";
import { DEBUG, runGraphWithStream, printStateHistory } from "./debug.js";
import readline from "node:readline/promises";

const THREAD_ID = "coding-agent-1";
const DEFAULT_WORKDIR = path.join(process.cwd(), "workspace");

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // 1. 工作目录
  const workdirAns = await rl.question(
    `生成代码的工作目录（回车默认 ${DEFAULT_WORKDIR}）> `
  );
  const workdir = workdirAns.trim() ? path.resolve(workdirAns.trim()) : DEFAULT_WORKDIR;
  console.log(`工作目录：${workdir}\n`);

  // 2. 记忆加载
  const mem = await loadMemory(workdir);
  let initial = {};
  if (mem && mem.project_doc) {
    const ans = await rl.question(
      `检测到上次会话存档（${mem.saved_at ?? "?"}，${mem.tasks?.length ?? 0} 个任务）。加载继续？[y/N] > `
    );
    if (ans.trim().toLowerCase() === "y" || ans.trim().toLowerCase() === "yes") {
      initial = {
        project_doc: mem.project_doc,
        decisions: mem.decisions ?? {},
        tasks: mem.tasks ?? [],
        task_index: mem.task_index ?? 0,
      };
      console.log("已加载上次会话记忆，跳过文档粘贴。\n");
    }
  }
  rl.close();

  // 3. 构建并运行图
  const { graph } = buildGraph({ workdir });
  const ui = createInterruptUI();
  const config = { configurable: { thread_id: THREAD_ID } };

  console.log("\n========== CodingAgent 启动 ==========");
  if (DEBUG) {
    console.log("调试模式：stream(updates) 实时打印每个节点的 State 变化\n");
  }

  // 4. 运行：默认 invoke；--debug 用 stream 实时看 State 变化（方案 A）
  let result;
  if (DEBUG) {
    result = await runGraphWithStream(graph, ui, config, initial);
  } else {
    result = await graph.invoke(initial, config);
    // interrupt 循环：展示 → 收集 → 恢复
    while (result.__interrupt__) {
      const values = await ui.handleInterrupts(result.__interrupt__);
      // LangGraph：单 interrupt 时 resume 传值，多 interrupt 时传数组
      const resume = values.length === 1 ? values[0] : values;
      result = await graph.invoke(new Command({ resume }), config);
    }
  }

  // 5. 调试模式：打印完整 State 历史快照（方案 B）
  if (DEBUG) {
    await printStateHistory(graph, config);
  }

  // 6. 存档
  const file = await saveMemory(workdir, pickMemory(result));
  console.log("\n========== 会话结束 ==========");
  console.log(file ? `已存档会话记忆：${file}` : "（未存档）");
}

main().catch((e) => {
  console.error("\n[错误] CodingAgent 运行失败：", e?.message ?? e);
  if (e?.stack) console.error(e.stack.split("\n").slice(0, 4).join("\n"));
  process.exit(1);
});
