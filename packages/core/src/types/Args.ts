
/** 输出形态。text = 人读（默认）；json = 结束时一行结构化结果；stream-json = 事件逐行 NDJSON */
export type OutputFormat = 'text' | 'json' | 'stream-json';

export interface CliArgs {
  workspacePath: string;
  resume: boolean;
  resumeSessionId: string | undefined;
  list: boolean;
  task: string | undefined;
  model: string;
  maxIterations: number;
  /** 累计 token 上限；不传表示不限制 */
  maxTokens: number | undefined;
  outputFormat: OutputFormat;
  /** 不询问，自动批准需要审批的动作（无人值守脚本用；会真的改文件、跑命令） */
  yes: boolean;
  help: boolean;
  dev:boolean; // 调试模式
}