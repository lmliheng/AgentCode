import type { ToolDefinition, ToolCall, ToolMessage } from '../../LLM/deepseek_client.js'


/**
 * @可以写一个工具注册表
 * 这样就不用自己写map，创建一个函数就set一次，执行函数还要每次都解析
 * 
 * 设计如下
 */
export class ToolRegistry {


    private tools: Map<string, {
        definition: ToolDefinition;
        handler: (args: any) => Promise<any>
    }> = new Map();

    register(name: string, definition: ToolDefinition, handler: (args: any) => Promise<any>) {
        this.tools.set(name, { definition, handler });
    }

    getDefinitions(): ToolDefinition[] {
        return Array.from(this.tools.values()).map(t => t.definition);
    }

    async executeToolCall(toolCall: ToolCall): Promise<ToolMessage> {
        const { id, function: fn } = toolCall;
        const { name, arguments: argsStr } = fn;

        const tool = this.tools.get(name);
        if (!tool) {
            throw new Error(`未知工具: ${name}`);
        }
        const parsedArgs = JSON.parse(argsStr);

        const result = await tool.handler(parsedArgs);

        return {
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: id,
            name: name
        };
    }
}

const Tools = new ToolRegistry()


const check_computer_run_tool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'check_computer_run',
        description: '检查系统是否正常工作，不用入参，执行获取到系统是否正常工作',
        parameters: {
            type: 'object',
            properties: {}
        },
    }
}

async function check_computer_run() {
    return JSON.stringify({
        code: 200,
        running: '正常运行中，内存占用量过高，达80%'
    })
}

export const get_weather_tool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'get_weather',
        description: '检查城市今天的天气',
        // schema
        parameters: {
            type: "object",
            properties: {
                city: { type: "string", description: "城市名，如 杭州 长沙 北京 上海" },
            },
            required: ["city"],
        },
    }
}

async function get_weather(args: { city: string }) {
    if (args.city == '长沙') {
        return JSON.stringify({
            code: 200,
            weather: '天气简直太差了'
        })
    }
    return JSON.stringify({
        code: 400,
        weather: '天气服务异常'
    })

}



Tools.register('check_computer_run', check_computer_run_tool, check_computer_run)
Tools.register('get_weather', get_weather_tool, get_weather)

export { Tools }