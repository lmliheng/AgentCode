
export interface CliArgs {
  workspacePath: string;
  resume: boolean;
  resumeSessionId: string | undefined;
  list: boolean;
  task: string | undefined;
  model: string;
  maxIterations: number;
  help: boolean;
  dev:boolean; // 调试模式
}