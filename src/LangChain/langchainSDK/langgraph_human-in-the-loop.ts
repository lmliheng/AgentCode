/**
 * @LangGraph 的human-in-the-loop机制
 * 
 */
import { START, END, StateGraph, MemorySaver, interrupt, Command, Annotation } from '@langchain/langgraph'

const State_ = Annotation.Root({
    draft: Annotation<string>,
    approved: Annotation<boolean | undefined>
})

const checkpoint = new MemorySaver()

/**
 * 
 * @人机节点
 * State_.State是Annotaion对象的一个静态属性
 */
async function reviewNode(state: typeof State_.State) {
    const decision = interrupt({
        kind: 'approve_email',
        draft: state.draft
    })
    return { approved: decision == 'approve' }
}

async function send_email(state: typeof State_.State) {
    console.log('send email ....', state.draft)
    return {}
}

const graph_builder = new StateGraph(State_)
    .addNode('review', reviewNode)
    .addNode('send_email', send_email)
    .addEdge(START, 'review')
    .addConditionalEdges('review', (s) => s.approved ? 'send' : END)
    .addEdge('send_email', END)

export const graph_1 = graph_builder.compile({ checkpointer: checkpoint })
