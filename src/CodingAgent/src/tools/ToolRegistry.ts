
import type { Tool } from '../types/Tool.js'
import { ReadFileTool } from './read_file.js';
import { ApplyDiffTool } from './apply_diff.js';
import { CreateFileTool } from './create_file.js';
import { DeleteFileTool } from './delete_file.js';
import { EditFileTool } from './edit_file.js';
import { FetchUrlTool } from './fetch_url.js';
import { GitOperationTool } from './git_operation.js';
import { ListFilesTool } from './list_files.js';
import { MoveFileTool } from './move_file.js';
import { ReadDirectoryTool } from './read_directory.js';
import { RunCommandTool } from './run_command.js';
import { SearchCodeTool } from './search_code.js';
import { ToolCallTool } from './tool_call.js';
import { ToolSearchTool } from './tool_search.js';
import { splitDeclaredTools } from './deferred.js';


/** 会产生文件变更的工具 */
export const MODIFYING_TOOLS = ['edit_file', 'delete_file', 'create_file', 'move_file', 'apply_diff', 'git_operation'];


export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  /**
   * 常驻白名单。undefined 表示不限制（全部常驻）；给出时，未列出的工具转为延迟——
   * 仍然注册、仍然可执行，只是 schema 不进首轮请求，模型改用 tool_search + tool_call 抵达。
   */
  private readonly eagerAllowList: readonly string[] | undefined;

  constructor(toolItems: [string, Tool][], eagerAllowList?: readonly string[]) {
    this.eagerAllowList = eagerAllowList;
    for (const item of toolItems) {
      this.tools.set(item[0], item[1])
    }
  }

  /**
   * 内置工具集合。
   *
   * 实例只在这里创建一次，工具自身无状态（运行时在构造时就把它们转成 Map，
   * 不会再改动工具对象），所以多条任务可以共用同一份注册表。
   *
   * 顺序与重构前保持一致：工具声明的顺序会随请求下发，
   * 无谓的调换会改变模型看到的前缀。
   *
   * @param eagerAllowList 常驻白名单；省略表示不限制
   */
  static createDefault(eagerAllowList?: readonly string[]): ToolRegistry {
    const registry = new ToolRegistry([], eagerAllowList);
    for (const tool of [
      new ReadFileTool(),
      new ApplyDiffTool(),
      new RunCommandTool(),
      new FetchUrlTool(),
      new CreateFileTool(),
      new GitOperationTool(),
      new ListFilesTool(),
      new EditFileTool(),
      new ReadDirectoryTool(),
      new DeleteFileTool(),
      new MoveFileTool(),
      new SearchCodeTool(),
    ]) {
      registry.register(tool);
    }

    // 桥工具最后注册，且豁免白名单：业务工具的相对顺序不变，
    // 声明前缀只在「哪些工具常驻」这一点上随配置变化。
    // 注意 ToolSearchTool 需要注册表自身——它要列出延迟工具。
    registry.register(new ToolSearchTool(registry));
    registry.register(new ToolCallTool());

    // 白名单里的无效名字必须报出来。qwen-code 只把它写进 debug 日志（默认不可见），
    // 于是「配置写错了」和「配置生效了」表面上没有区别。
    const unknown = registry.getUnknownEagerNames();
    if (unknown.length > 0) {
      throw new Error(
        `常驻白名单里的名字不在工具集合里: ${unknown.join(', ')}。` +
        `可用工具: ${registry.getAllToolNames().join(', ')}`,
      );
    }

    return registry;
  }

  register(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  /** 返回所有工具名（用于 tool_search） */
  getAllToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /** 获取单个工具 schema（用于 tool_call 时校验） */
  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** 全部工具，交给 AgentRuntime 生成并下发工具声明 */
  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /** 常驻工具：schema 随首轮请求下发 */
  getEagerTools(): Tool[] {
    return splitDeclaredTools(this.getAllTools(), this.eagerAllowList).eager;
  }

  /** 延迟工具：注册且可执行，但 schema 不进请求，需经 tool_search + tool_call 抵达 */
  getDeferredTools(): Tool[] {
    return splitDeclaredTools(this.getAllTools(), this.eagerAllowList).deferred;
  }

  /** 白名单里写了、却不在工具集合里的名字 */
  getUnknownEagerNames(): string[] {
    return splitDeclaredTools(this.getAllTools(), this.eagerAllowList).unknownNames;
  }
}