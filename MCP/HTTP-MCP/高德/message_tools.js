/**
 * @单轮对话message格式初始化
 * 这个函数可以不用，作参考意义
 */
export function messageCreate(message, role) {
    return [
        { "role": "user", "content": `${message}` }
    ]
}
/**
 * @多轮对话message增加
 */
export function messageAdd(messageObject, message, role) {
    return messageObject.push({ "role": `${role}`, "content": `${message}` })
}