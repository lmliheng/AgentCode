// 参考 qwencode 常驻工具的白名单设计。
//
// 语义（对齐 qwen-code 的 `tools.eager`）：
// - 列进 eager 的工具：schema 随首轮请求下发，模型可直接调用。
// - 未列出的工具：**仍然注册、仍然可执行**，只是 schema 不进请求；模型先用
//   tool_search 取它的 schema，再用 tool_call 调用它。
// - 省略整个 eager 字段表示不限制（全部常驻）。写空数组是有效配置，等于全部延迟。
// - tool_search / tool_call 两个桥工具豁免于此名单，永远常驻：延迟工具之所以
//   「延迟但可用」全靠它们，任一缺失，被延迟的工具就既看不到也够不到。
//
// 白名单里出现工具集合之外的名字会在启动时直接报错（见 ToolRegistry.createDefault），
// 而不是被静默忽略——qwen-code 只把它写进 debug 日志，于是「配置写错」与
// 「配置生效」表面上没有区别。
export const config = {
    tools: {
        eager: [
            // 感知层：读文件、搜代码、列目录
            'read_file',
            'search_code',
            'list_files',
            // 动作层：改文件、跑命令、取网页
            'edit_file',
            'create_file',
            'run_command',
            'fetch_url',
            // 延迟：apply_diff / delete_file / move_file / read_directory / git_operation
        ],

    },
};
