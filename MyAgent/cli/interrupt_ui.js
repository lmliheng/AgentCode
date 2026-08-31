/**
 * @cli/interrupt_ui.js
 * 人机交互层（决策 1：终端 CLI；决策 4：interrupt + checkpointer）
 *
 * 职责：处理图执行返回的 __interrupt__ 列表，
 * 按 interrupt.kind 定制展示与输入收集，返回 resume 值数组。
 * 上层用 Command({ resume: values }) 恢复图执行。
 *
 * 教学要点：
 * - 图在 interrupt() 处暂停，把 payload（value）返回给调用方
 * - CLI 层负责展示 + 收集用户输入 + 作为 resume 值送回
 * - 节点从 interrupt() 处拿到 resume 值继续执行
 */
import readline from "node:readline/promises";

/**
 * 创建 CLI 交互层
 */
export function createInterruptUI() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  /**
   * 处理一次返回的 interrupt 列表，逐个收集用户输入
   * @param {Array} interrupts result.__interrupt__ 数组
   * @returns {Promise<Array>} 与 interrupts 顺序对应的 resume 值
   */
  async function handleInterrupts(interrupts) {
    const values = [];
    for (const it of interrupts) {
      const value = await promptFor(it.value);
      values.push(value);
    }
    return values;
  }

  /** 按 kind 分发到对应的交互流程 */
  async function promptFor(payload) {
    switch (payload.kind) {
      case "collect_doc":
        return promptDoc();
      case "feasibility_gate":
        return promptFeasibility(payload);
      case "missing_point":
        return promptMissing(payload);
      case "feedback":
        return promptFeedback(payload);
      default:
        return rl.question(">>> ");
    }
  }

  /** 粘贴项目文档：连续读取多行，空行结束 */
  async function promptDoc() {
    console.log("\n────────────────────────");
    console.log("请粘贴项目文档（粘贴内容后，输入一个空行结束）：");
    const lines = [];
    while (true) {
      const line = await rl.question("  ");
      if (line.trim() === "") {
        if (lines.length === 0) {
          console.log("  文档不能为空，请粘贴内容或输入 Ctrl+C 退出。");
          continue;
        }
        break;
      }
      lines.push(line);
    }
    return lines.join("\n");
  }

  /** 可行性门：展示严重问题，用户选 继续 / 补充文档 / 终止 */
  async function promptFeasibility(payload) {
    const a = payload.analysis;
    console.log("\n────────────────────────");
    console.log("[可行性门] 文档分析发现严重问题，无法直接开发：");
    for (const b of a.blockers ?? []) {
      console.log(`  ⚠ ${b}`);
    }
    console.log("  可行性评分：" + a.feasibility.score + "/10");
    console.log("  可行性结论：" + a.feasibility.conclusion);
    console.log("  可靠性结论：" + a.reliability.conclusion);
    while (true) {
      const ans = await rl.question("如何处理？ [1] 继续开发  [2] 补充文档重来  [3] 终止 > ");
      if (ans === "1") return "continue";
      if (ans === "2") return "reprovide";
      if (ans === "3") return "terminate";
      console.log("  请输入 1 / 2 / 3");
    }
  }

  /** 遗漏点确认：展示问题与选项（含自定义），编号或直接输入自定义方案 */
  async function promptMissing(payload) {
    console.log("\n────────────────────────");
    console.log(`[遗漏确认] ${payload.module}：${payload.question}`);
    payload.options.forEach((opt, i) => {
      console.log(`  [${i + 1}] ${opt}`);
    });
    while (true) {
      const ans = await rl.question("请选择（输入编号，或输入自定义方案）> ");
      const n = Number(ans.trim());
      if (Number.isInteger(n) && n >= 1 && n <= payload.options.length) {
        return payload.options[n - 1];
      }
      if (ans.trim() !== "") return ans.trim(); // 自定义
      console.log("  输入不能为空");
    }
  }

  /** 反馈确认：展示任务结果，Y / 修改(输入意见) / 终止 */
  async function promptFeedback(payload) {
    const task = payload.task ?? {};
    const result = payload.result ?? {};
    console.log("\n────────────────────────");
    console.log("【功能完成】");
    console.log(`  任务：${task.task_id ?? "?"}  模块：${task.module ?? "?"}`);
    console.log(`  目标：${task.goal ?? "?"}`);
    console.log(`  文件：`);
    for (const f of result.files ?? task.core_files ?? []) {
      console.log(`    - ${f}`);
    }
    const summary = (result.summary ?? "").trim();
    if (summary) {
      console.log(`  开发总结：${summary.length > 500 ? summary.slice(0, 500) + "…" : summary}`);
    }
    if (payload.remaining > 0) {
      console.log(`  剩余任务：${payload.remaining} 个`);
    }
    while (true) {
      const ans = await rl.question("是否继续？ [Y] 继续  [M] 修改（输入意见）  [T] 终止 > ");
      const v = ans.trim().toUpperCase();
      if (v === "Y" || v === "YES") return "Y";
      if (v === "T" || v === "TERMINATE" || v === "N" || v === "NO") return "TERMINATE";
      if (v === "M" || v === "MODIFY" || v.startsWith("修改")) {
        const msg = await rl.question("请输入修改意见 > ");
        if (msg.trim() !== "") return { type: "MODIFY", message: msg.trim() };
        console.log("  修改意见不能为空");
        continue;
      }
      console.log("  请输入 Y / M / T");
    }
  }

  return { handleInterrupts, rl };
}
