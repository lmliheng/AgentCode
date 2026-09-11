/**
 * @test/debug_e2e.js
 * 验证 debug.js 的方案 A（stream 实时打印）+ 方案 B（history 快照）
 * 在完整 CodingAgent 流程下工作（真实调用 LLM，模拟用户输入）。
 *
 * 运行：node --env-file=../.env test/debug_e2e.js
 */
import { buildGraph } from "../graph.js";
import { runGraphWithStream, printStateHistory, C } from "../debug.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

const PROJECT_DOC = `项目名称：CalcCLI
项目目标：命令行计算器，支持加减乘除。
功能：calc add 1 2、calc sub 5 3、calc mul 2 3、calc div 6 2。
技术栈：Node.js ESM，无依赖。`;

function mockUser(payload) {
  switch (payload.kind) {
    case "collect_doc":
      return PROJECT_DOC;
    case "feasibility_gate":
      return "continue";
    case "missing_point":
      return payload.options[0];
    case "feedback":
      return payload.remaining > 0 ? "Y" : "TERMINATE";
    default:
      return "";
  }
}

const mockUI = {
  async handleInterrupts(interrupts) {
    console.log(`${C.yellow}[debug_e2e] 模拟用户回答 ${interrupts.length} 个 interrupt：${interrupts.map((i) => i.value.kind).join(", ")}${C.reset}`);
    return interrupts.map((it) => mockUser(it.value));
  },
};

async function main() {
  const workdir = path.join(os.tmpdir(), "myagent-debug-" + Date.now());
  await fs.mkdir(workdir, { recursive: true });
  const { graph } = buildGraph({ workdir });
  const config = { configurable: { thread_id: "debug-e2e" } };

  console.log(`${C.cyan}===== 方案 A：stream(updates) 实时 State 变化 =====${C.reset}`);
  const finalState = await runGraphWithStream(graph, mockUI, config, {});

  console.log(`${C.cyan}\n===== 方案 B：State 历史快照 =====${C.reset}`);
  await printStateHistory(graph, config);

  console.log(`\n最终任务数：${finalState.tasks?.length ?? 0}，terminated：${finalState.terminated}`);
  const entries = await fs.readdir(workdir, { recursive: true });
  const files = entries.filter((e) => typeof e === "string");
  console.log("工作目录文件：", files.length ? files.join(", ") : "（空）");

  const ok = (finalState.tasks?.length ?? 0) > 0 && files.length > 0;
  console.log(ok ? "\n✅ debug_e2e 通过" : "\n❌ debug_e2e 失败");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("\n[debug_e2e 错误]", e?.message ?? e);
  process.exit(1);
});
