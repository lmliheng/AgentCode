/**
 * @test/smoke.js
 * 冒烟测试：不调用任何 LLM API，只验证图能构建、
 * 节点/边注册正确、fs 工具的安全校验生效。
 *
 * 运行：node test/smoke.js
 */
import { buildGraph } from "../graph.js";
import { createFsTools } from "../tools/fs_tools.js";
import { CodingAgentState, DevState } from "../state.js";
import os from "node:os";
import path from "node:path";

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

console.log("=== 1. 图构建 ===");
const workdir = path.join(os.tmpdir(), "myagent-smoke-" + Date.now());
const { graph, tools } = buildGraph({ workdir });
check("图编译成功", !!graph);
check("fs 工具 3 个", tools.length === 3);

console.log("=== 2. State schema 字段 ===");
const stateFields = Object.keys(CodingAgentState.spec ?? CodingAgentState);
for (const f of ["project_doc", "analysis", "missing_points", "decisions", "plan", "tasks", "task_index", "current_task", "current_result", "dev_messages", "feedback", "modify_message", "terminated", "messages"]) {
  check(`外层 State 含 ${f}`, stateFields.includes(f));
}
const devFields = Object.keys(DevState.spec ?? DevState);
for (const f of ["messages", "task", "step", "result"]) {
  check(`内层 State 含 ${f}`, devFields.includes(f));
}

console.log("=== 3. fs 工具安全校验 ===");
const tmpRoot = path.join(os.tmpdir(), "myagent-root-" + Date.now());
const fsTools = createFsTools(tmpRoot);
const readFile = fsTools.find((t) => t.name === "read_file");
const writeFile = fsTools.find((t) => t.name === "write_file");
check("read_file 存在", !!readFile);
check("write_file 存在", !!writeFile);

// 写文件成功
const writeRes = await writeFile.invoke({ path: "src/a.js", content: "console.log(1)" });
check("write_file 写文件成功", writeRes.includes("已写入"));

// 读文件成功
const readRes = await readFile.invoke({ path: "src/a.js" });
check("read_file 读文件成功", readRes.includes("console.log"));

// 越界被拒
const escapeRes = await readFile.invoke({ path: "../../etc/passwd" });
check("越界路径被拒", escapeRes.includes("失败"));

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
