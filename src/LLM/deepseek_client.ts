
export type ChatMessage =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage;
/**
 * @历史消息类型
 *  
 * 以下消息类型都是适配deepseek的
 */
export interface BaseMessage {
  content: string | null;
  reasoning_content?: string;
}
export interface SystemMessage extends BaseMessage {
  role: 'system';
  content: string;
}
export interface UserMessage extends BaseMessage {
  role: 'user';
  content: string;
}
/**
 * @agent消息接口
 */
export interface AssistantMessage extends BaseMessage {
  role: 'assistant';
  content: string | null;
  reasoning_content?: string // 调用工具原因
  tool_calls?: ToolCall[]; //工具列表
  tool_call_id?: string; // 工具id
  name?: string;
}
/**
 * @tool消息接口
 */
export interface ToolMessage extends BaseMessage {
  role: 'tool';
  content: string; // 返回类型
  tool_call_id?: string; // 工具id
  name?: string;
}

/**
 * @Tool定义类型
 */
export type ToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchemaObject
  };
}

type JsonSchemaObject = {
  type: "object";
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
}

type JsonSchemaProperty = {
  type: "string" | "number" | "boolean" | "integer" | "array" | "object";
  description?: string;
  enum?: string[];
  items?: JsonSchemaProperty;  // 如果是 array
  properties?: Record<string, JsonSchemaProperty>;  // 如果是嵌套 object
  required?: string[];
}

export interface ToolCall {
  index: number
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * LLM 完成原因
 * - stop: 模型自然停止
 * - length: 达到最大 token 限制
 * - tool_calls: 模型调用了工具（需要继续处理）
 * - content_filter: 内容被过滤
 * - null: 仍在生成中
 */
type FinishReason = 'stop' | '' | 'length' | 'tool_calls' | 'content_filter';
/**
 * @接口响应
 */
export interface DeepSeekResponse {
  message: AssistantMessage
  finishReason: FinishReason;
  latencyMs: number;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * @余额接口响应    
 */
export interface BalanceInfo {
  balance: number;
  granted_balance: number;
  topped_up_balance: number;
  currency: string;
  [key: string]: unknown;
}

/**
 * 
 * @调用Deepseek对话
 */
export async function callDeepSeek(
  messages: ChatMessage[],
  extra: {
    tools?: ToolDefinition[];
    thinking?: boolean;
    [key: string]: unknown;
  } = {}
): Promise<DeepSeekResponse> {
  const { apiKey, baseUrl, model } = getApiConfig();
  const startedAt = Date.now();

  const { tools, thinking, ...options } = extra;

  const body: Record<string, unknown> = {
    model,
    messages,
    ...options,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  if (thinking) {
    body.thinking = { type: 'enabled' };
  }

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `DeepSeek 调用失败：${response.status} ${JSON.stringify(data)}`
    );
  }

  const choice = data.choices?.[0];
  if (!choice?.message) {
    throw new Error(`DeepSeek 没有返回有效消息：${JSON.stringify(data)}`);
  }

  return {
    message: choice.message,
    finishReason: choice.finish_reason ?? null,
    latencyMs: Date.now() - startedAt,
    usage: data.usage,
  };
}


/**
 * 查询账户余额
 */
export async function getDeepseekBalance(): Promise<BalanceInfo | undefined> {
  const token = process.env.DEEPSEEK_API_KEY;
  if (!token) {
    throw new Error('DEEPSEEK_API_KEY 未设置，检查 .env 和 dotenv 加载顺序');
  }

  try {
    const response = await fetch('https://api.deepseek.com/user/balance', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`余额查询失败: HTTP ${response.status}`);
    }

    return (await response.json()) as BalanceInfo;
  } catch (error) {
    console.error('余额查询请求失败:', (error as Error).message);
    return undefined;
  }
}



/**
 * 
 * @环境变量检查
 */
function getApiConfig() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 DEEPSEEK_API_KEY，请先在 .env 中完成配置。');
  }
  return {
    apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
  };
}