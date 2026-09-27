
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
  help: boolean;
  dev:boolean; // 调试模式
}