
/** 输出形态。text = 人读（默认）；json = 结束时一行结构化结果；stream-json = 事件逐行 NDJSON */
export type OutputFormat = 'text' | 'json' | 'stream-json';

/**
 * 提供方（协议族）。
 *
 * `openai` 指的是 `/chat/completions` 这一套协议而不是某一家厂商：Moonshot、通义、
 * 智谱、本机的 Ollama / vLLM 都能用它，靠 baseUrl 指到对应端点。
 * anthropic 与 gemini 是另一套协议，尚未实现。
 */
export type ProviderName = 'deepseek' | 'openai';

export interface CliArgs {
  workspacePath: string;
  resume: boolean;
  resumeSessionId: string | undefined;
  list: boolean;
  task: string | undefined;
  model: string;
  provider: ProviderName;
  /** 覆盖提供方的端点（本机 Ollama / vLLM 之类）。不传就用该提供方的默认端点 */
  baseUrl: string | undefined;
  maxIterations: number;
  /** 累计 token 上限；不传表示不限制 */
  maxTokens: number | undefined;
  outputFormat: OutputFormat;
  /** 不询问，自动批准需要审批的动作（无人值守脚本用；会真的改文件、跑命令） */
  yes: boolean;
  help: boolean;
  dev:boolean; // 调试模式
}