import {type Task} from './task-runner.js'
export const taskList: Task[] = [
  [
    "文件读取与搜索类",
    "找出 src/tools/run_command.ts 中所有导出函数的名称，并将它们整理成一个 Markdown 列表写入 run_test/tools_list.md"
  ],
  [
    "代码编辑类",
    "在 src/index.ts 中添加一行注释 // Agent entry point，然后在同一文件中导出一个名为 createAgent 的空函数"
  ],
  [
    "多步文件操作类",
    "1. 读取 src/test/ds.test.ts 的前 30 行\n2. 将其中的 describe 改为 describe.skip\n3. 将修改后的内容写入 run_test/modified_test.md"
  ],
  [
    "Git 操作类",
    "查看当前 Git 仓库的最后 3 条提交记录，提取每条记录的 commit hash 和 message，写入 run_test/git_log.md"
  ],
  [
    "目录遍历与统计类",
    "列出 src/tools 目录下所有 .ts 文件的文件名和大小，按文件大小从大到小排序，写入 run_test/file_sizes.md"
  ],
  [
    "网络请求类",
    "请求 https://httpbin.org/get，将返回的 JSON 中的 url 字段值写入 run_test/request_result.md"
  ],
  [
    "跨目录移动文件类",
    "在根目录创建一个文件 temp_note.txt 内容为 hello agent，然后将它移动到 run_test/ 目录下，再删除原位置的文件"
  ],
  [
    "复杂计划与依赖类",
    "查询今天长沙天气（假设通过 curl wttr.in/Changsha 或类似命令），并将结果保存到 run_test/weather.md，同时将当前目录结构也追加到同一个文件末尾"
  ],
  [
    "类型检查与测试运行类",
    "运行 TypeScript 类型检查（npx tsc --noEmit），将输出结果写入 run_test/typecheck.md；若类型检查通过，再运行一次 npm run test:ds 并将结果追加到同一文件"
  ],
  [
    "极限场景：超时与错误恢复类",
    "执行一个会卡住的命令（如 ping 127.0.0.1 -t），Agent 应能在超时后识别失败并切换到备用方案——改为执行 echo \"fallback success\"，将最终结果写入 run_test/timeout_recovery.md"
  ]
];