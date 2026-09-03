/**
 * @test/e2e.js
 * 端到端测试：模拟一次完整 CodingAgent 会话（真实调用 DeepSeek）。
 * 不经过 index.js 的 readline，而是直接驱动图，按 interrupt.kind 提供预设回答。
 *
 * 运行：node --env-file=../.env test/e2e.js
 */
import { Command } from "@langchain/langgraph";
import { buildGraph } from "../graph.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

const PROJECT_DOC = `项目名称：TodoCLI
项目目标：开发一个 Node.js 命令行待办事项应用。
功能：
1. 添加待办：todo add "内容"
2. 列出待办：todo list
3. 删除待办：todo delete <id>
数据存储：JSON 文件（todos.json）。
技术栈：Node.js（ESM），无第三方依赖。`;

// 模拟用户回答的预设（按 interrupt.kind）
function mockUser(payload) {
  switch (payload.kind) {
    case "collect_doc":
      return PROJECT_DOC;
    case "feasibility_gate":
      return "continue";
    case "missing_point":
      return payload.options[0]; // 选第一个选项
    case "feedback":
      // 第一个任务 Y 继续，第二个任务终止（控制测试规模）
      return payload.remaining > 0 ? "Y" : "TERMINATE";
    default:
      return "";
  }
}

async function main() {
  const workdir = path.join(os.tmpdir(), "myagent-e2e-" + Date.now());
  await fs.mkdir(workdir, { recursive: true });
  console.log(`工作目录：${workdir}\n`);

  const { graph } = buildGraph({ workdir });
  const config = { configurable: { thread_id: "e2e-test" } };

  let result = await graph.invoke({}, config);
  let interrupts = 0;
  while (result.__interrupt__) {
    interrupts++;
    const values = result.__interrupt__.map((it) => mockUser(it.value));
    console.log(`\n[E2E] interrupt #${interrupts}: ${result.__interrupt__.map((i) => i.value.kind).join(", ")}`);
    // 单 interrupt 传值，多 interrupt 传数组
    const resume = values.length === 1 ? values[0] : values;
    result = await graph.invoke(new Command({ resume }), config);
  }

  console.log("\n========== E2E 结果 ==========");
  console.log("任务数：", result.tasks?.length ?? 0);
  console.log("task_index：", result.task_index);
  console.log("terminated：", result.terminated);
  console.log("decisions：", JSON.stringify(result.decisions ?? {}));

  // 检查工作目录里是否真的生成了文件
  const entries = await fs.readdir(workdir, { recursive: true });
  const files = entries.filter((e) => typeof e === "string");
  console.log("工作目录内容：", files.length ? files.join(", ") : "（空）");

  const ok = (result.tasks?.length ?? 0) > 0 && files.length > 0;
  console.log(ok ? "\n✅ E2E 通过" : "\n❌ E2E 失败");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("\n[E2E 错误]", e?.message ?? e);
  process.exit(1);
});
