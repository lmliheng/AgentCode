/**
 * @Jev（TypeSafe System One 模型）客户端
 *
 * Jev 不是聊天模型，不能走 /chat/completions：它接收一段状态 + 一组带类型的提问，
 * 返回结构化答案。这里走 OpenRouter 的 decisions alpha 路由：
 * POST https://openrouter.ai/api/alpha/decisions
 * 见 https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request
 */

/**
 * @待评估的状态
 * 一段纯文本，或一组结构化上下文（对象/数组）
 */
export type JevState = string | Record<string, unknown> | unknown[];

/**
 * @判据文本
 * 纯字符串，或结构化内容（对象/数组）
 */
export type JevCriteria = string | Record<string, unknown> | unknown[];

/**
 * @二值题
 * 返回 0~1 的概率（noul 是"是/否"的概率值，不是布尔）
 */
export interface JevNoulQuestion {
  type: 'noul';
  instructions: JevCriteria;
  criteria?: { true: JevCriteria; false: JevCriteria };
}

/**
 * @单选题
 * 从 criteria 的键里选一个，返回选中项与各项概率
 */
export interface JevChoiceQuestion {
  type: 'choice';
  instructions: JevCriteria;
  criteria: Record<string, JevCriteria | null>;
}

/**
 * @打分题
 * criteria 是"由低到高"的有序等级，返回落在第几级
 */
export interface JevScoreQuestion {
  type: 'score';
  instructions: JevCriteria;
  criteria: JevCriteria[];
}

export type JevQuestion =
  | JevNoulQuestion
  | JevChoiceQuestion
  | JevScoreQuestion;

/**
 * @二值题答案
 */
export interface JevNoulAnswer {
  type: 'noul';
  noul: number;
}

/**
 * @单选题答案
 */
export interface JevChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}

/**
 * @打分题答案
 * legend 是等级序号到原始判据的回映射
 */
export interface JevScoreAnswer {
  type: 'score';
  score: number;
  confidence?: number;
  probabilities?: Record<string, number>;
  legend?: Record<string, JevCriteria>;
}

export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

/**
 * @接口响应
 * answers 的键与请求里的 questions 一一对应
 */
export interface JevResponse {
  id?: string;
  model: string;
  provider?: string;
  answers: Record<string, JevAnswer>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cost?: number;
  };
  latencyMs: number;
}

/**
 * @调用Jev做一次决策
 *
 * 例子：
 * const res = await callJev('我被重复扣款了', {
 *   refund: { type: 'noul', instructions: '客户是否在要求退款？' },
 * })
 * if (res.answers.refund?.type === 'noul') console.log(res.answers.refund.noul)
 */
export async function callJev(
  state: JevState,
  questions: Record<string, JevQuestion>,
  extra: {
    model?: string;
    session_id?: string;
    user?: string;
    provider?: Record<string, unknown>;
    trace?: Record<string, unknown>;
    [key: string]: unknown;
  } = {}
): Promise<JevResponse> {
  const { apiKey, baseUrl, model } = getJevConfig();
  const startedAt = Date.now();

  const { model: modelOverride, ...options } = extra;

  const body: Record<string, unknown> = {
    model: modelOverride ?? model,
    state,
    questions,
    ...options,
  };

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
    throw new Error(`Jev 调用失败：${response.status} ${JSON.stringify(data)}`);
  }

  return {
    id: data.id,
    model: data.model,
    provider: data.provider,
    answers: data.answers,
    usage: data.usage,
    latencyMs: Date.now() - startedAt,
  };
}

/**
 * @环境变量检查
 */
function getJevConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 OPENROUTER_API_KEY，请先在 .env 中完成配置。');
  }
  return {
    apiKey,
    baseUrl:
      process.env.JEV_BASE_URL ||
      'https://openrouter.ai/api/alpha/decisions',
    // ~typesafe/jev-latest 是 OpenRouter 给 Jev 最新版的别名，也可写 typesafe/jev-1.13
    model: process.env.JEV_MODEL || '~typesafe/jev-latest',
  };
}
