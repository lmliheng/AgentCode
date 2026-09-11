

export type Role = 'user' | 'system' | 'assistant' | 'tool';

/**
 * @历史消息类型
 */
export interface ChatMessage {
    role: Role;
    content: string | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
    name?: string;
}

/**
 * @Tool定义类型
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}


/**
 * @接口响应
 */
export interface DeepSeekResponse {
  message: {
    role: string;
    content: string | null;
    tool_calls?: ToolCall[];
  };
  finishReason: string | null;
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