
type Role = 'user' | 'system' | 'assistant' | 'tool';
import type { ChatMessage, SystemMessage, UserMessage } from './deepseek_client.js'


/**
 * @单轮对话message格式初始化
 * 这个函数可以不用，作参考意义
 * 
 * 其实可以设计成对象，但是langchain/message已经设计了 我这不要重复设计了
 */
export function UserMessageCreate(message: string): ChatMessage[] {
    return [
        { "role": "user", "content": `${message}` }
    ]
}
export function SystemMessageCreate(message: string): ChatMessage[] {
    return [
        { "role": "system", "content": `${message}` }
    ]
}

/**
 * @多轮对话message增加
 */
export function MessageAdd(messageObject: ChatMessage[], message: string, role: Role) {
    messageObject.push({ "role": `${role}`, "content": `${message}` })
    return messageObject
}

/**
 * @message加入
 * 合并新的ChatMessage
 */
export function MessageCombine(message: ChatMessage[], message2: ChatMessage) {
    message.push(message2)
    return message
}