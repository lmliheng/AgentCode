import { Command } from '@langchain/langgraph'
import { graph_1 } from './langgraph_human-in-the-loop.js'
import { graph_2 } from './langgraph.js'
import * as readline from 'readline'

if (process.argv[2] == 'graph') {
    const res = await graph_2.invoke('')
    console.log(res)
}


if (process.argv[2] == 'human') {
    // console.log(graph_1)
    const config = { configurable: { thread_id: 'graph里人机协作的测试案例' } }
    /**
     * @中断过程的Agent响应
     */
    const r1 = await graph_1.invoke({ draft: '是否发出邮箱, 同意approve/拒绝no:' }, config)
    console.log(r1.__interrupt__)
    /**
     * @用户回答结果
     * 在实际中把resume属性里的内容
     * 换成 等待用户回复的异步任务
     */
    const r2 = await graph_1.invoke(new Command({ resume: 'approve' }), config)
    console.log(r2.approved)
}


if (process.argv[2] == 'human-rl') {
    // console.log(graph_1)
    const config = { configurable: { thread_id: 'graph里人机协作的测试案例' } }
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    })
    // Agent返回响应，等待人的回复
    const res_interrupt = await graph_1.invoke({ draft: '是否发出邮箱, 同意approve/拒绝no:' }, config)
    console.log(res_interrupt)
    rl.question('', async (answer) => {
        if (answer !== 'approve') {
            console.log('停止发送邮箱')
            rl.close()
            return
        }
        const res = await graph_1.invoke(new Command({ resume: answer }), config)
        console.log('', res)
        rl.close()
    })

}