/**
 * 本质是告诉模型我有哪些功能Tools，resource，prompts，模型返回它需要调用的（在response.message.tool_calls数组里）
 * 我本地来调用后，加入到context，下一次循环继续，直到模型不再需要调用，也就是tool_calls数组为空
 */
