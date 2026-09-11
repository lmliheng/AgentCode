
import type { Role, ChatMessage } from './deepseek_client.js'

/**
 * @单轮对话message格式初始化
 * 这个函数可以不用，作参考意义
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