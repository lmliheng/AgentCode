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
 * @工具调用
 */
export interface ToolCall {
  index: number
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}