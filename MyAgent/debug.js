/**
 * @debug.js
 * LangGraph 调试工具（方案 A+B）：
 *
 * A. runGraphWithStream：用 graph.stream("updates") 替代 invoke，
 *    实时打印每个节点运行后的 State 增量（谁更新了哪些字段）。
 *    interrupt 时打印暂停点，CLI 收集输入后 resume 继续。
 *
 * B. printStateHistory：结束后用 get_state_history 打印
 *    每个节点执行后的完整 State 快照（时间倒序）。
 *
 * 用法：node --env-file=../.env index.js --debug
 */
import { Command } from "@langchain/langgraph";

/** 终端颜色 */
export const C = {
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  reset: "\x1b[0m",
};

/** 是否开启调试（index.js 传 --debug） */
export const DEBUG = process.argv.includes("--debug");



/**
 * 把 State 更新/快照压缩成一行可读文本
 * 数组显示长度，对象显示键列表，长字符串截断
 */
export function summarize(obj) {
  if (obj == null) return "null";
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    let val;
    if (Array.isArray(v)) {
      val = `[${v.length} 项]`;
    } else if (v && typeof v === "object") {
      val = `{${Object.keys(v).join(",")}}`;
    } else if (typeof v === "string") {
      val = v.length > 60 ? `"${v.slice(0, 60)}…"` : `"${v}"`;
    } else {
      val = String(v);
    }
    parts.push(`${k}: ${val}`);
  }
  return parts.length ? parts.join("  ") : "(无更新)";
}



/** 打印一个节点执行后的 State 增量（stream updates chunk） */
export function printUpdate(chunk) {
  for (const [nodeName, update] of Object.entries(chunk)) {
    if (nodeName === "__interrupt__") continue;
    console.log(
      `${C.cyan}▶ 节点 ${nodeName}${C.reset} 更新 State：${C.dim}${summarize(update)}${C.reset}`
    );
  }
}



/** 打印 interrupt 暂停点 */
export function printInterrupt(interrupts) {
  for (const it of interrupts) {
    const v = it.value ?? {};
    console.log(`${C.yellow}⏸ interrupt 暂停：kind=${v.kind}${C.reset}`);
    if (v.question) console.log(`   问题：${v.question}`);
    if (v.module) console.log(`   模块：${v.module}`);
  }
}



/**
 * 方案 A：用 stream("updates") 运行图，实时打印 State 变化
 * @param {object} graph 编译后的图
 * @param {object} ui createInterruptUI 实例
 * @param {object} config 含 thread_id 的配置
 * @param {object} initial 初始输入
 * @returns {Promise<object>} 最终 State（通过 getState 获取）
 */
export async function runGraphWithStream(graph, ui, config, initial) {
  let input = initial;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const stream = await graph.stream(input, { ...config, streamMode: "updates" });
    let interrupts = null;
    for await (const chunk of stream) {
      if (chunk.__interrupt__) {
        interrupts = chunk.__interrupt__;
        printInterrupt(interrupts);
      } else {
        printUpdate(chunk);
      }
    }
    if (!interrupts) break; // 图跑完
    // 收集用户输入并 resume 继续
    const values = await ui.handleInterrupts(interrupts);
    input = new Command({ resume: values.length === 1 ? values[0] : values });
  }
  const snap = await graph.getState(config);
  return snap.values;
}

/**
 * 方案 B：打印每个节点执行后的 State 快照（get_state_history，时间倒序）
 */
export async function printStateHistory(graph, config) {
  console.log(`\n${C.green}===== State 历史快照（get_state_history）=====${C.reset}`);
  let i = 0;
  for await (const h of await graph.getStateHistory(config)) {
    const node = Array.isArray(h.next) && h.next.length ? h.next.join(",") : "(END)";
    console.log(`  #${String(i++).padStart(2)} ${C.dim}${node}${C.reset} → ${summarize(h.values)}`);
  }
}
