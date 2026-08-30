import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { AIMessage, BaseMessage } from "@langchain/core/messages";
/**
 * @LangGraph
 * 创建状态，创建图，增加执行逻辑Node，增加边Egde，
 * 编译运行agent
 *
 * 这里没有做的有：
 * 1. 调用模型
 * 2. 没有调用工具
 * 3. 没有记忆
 * 4. 没有human-in-the-loop/interrupt
 */
/**
 * @state：state schema / annotation
 * 使用StateSchema也行
 *
 */
const StateAn = Annotation.Root({
    messages: Annotation({
        reducer: (x, y) => {
            return x.concat(Array.isArray(y) ? y : []);
        },
        default: () => [],
    }),
    nextStep: Annotation({
        reducer: (x, y) => y ?? x,
        default: () => "agent",
    }),
});
async function agentNode(state) {
    return {
        messages: [new AIMessage("hello from agent")],
        nextStep: "tool",
    };
}
async function toolNode(state) {
    return {
        nextStep: END,
    };
}
/**
 * @创建图
 * 增加节点和边
 */
const graph_builder = new StateGraph(StateAn)
    .addNode('agent', agentNode)
    .addNode('tool', toolNode)
    .addEdge(START, 'agent')
    .addEdge('agent', 'tool')
    .addConditionalEdges('tool', (state) => state.nextStep === END ? END : 'agent');
export const graph_2 = graph_builder.compile();
