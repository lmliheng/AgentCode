const { getDeepseekBalance } = require("./deepseek_client")

// ES 写法 这里会报错
// let balance=await getDeepseekBalance()

async function testGetDeepseekBalance() {
    try {
        const balance = await getDeepseekBalance()
        console.log(balance)
    } catch (error) {
        console.error('获取余额失败:', error.message)
    }
}
testGetDeepseekBalance()

async function testDeepseekChat(message) {
    
}