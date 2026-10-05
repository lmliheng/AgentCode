// test/mcp.test.ts
//
// MCP stdio 客户端的端到端测试：起的都是真子进程（test/fixtures/mcp-stub-server.mjs），
// 走的是真管道。刻意不 mock node:child_process —— 这一层要防的正是「跟真进程打交道」
// 时才会出现的问题：握手顺序、分页、超时、退出后残留。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import type { ToolContext, ToolParams } from '@lmliheng/acode-core';

import {
    McpClient,
    McpTool,
    connectMcpServers,
    loadMcpConfig,
    mcpConfigFile,
    mcpToolName,
    renderContent,
    uniqueMcpToolName,
} from '../src/mcp/index.js';

import type { McpConnectionSet, McpServerConfig } from '../src/mcp/index.js';

const STUB = fileURLToPath(new URL('./fixtures/mcp-stub-server.mjs', import.meta.url));

/** 直接跑 node 本体：不依赖 tsx，也不依赖构建产物 */
function stubConfig(env?: Record<string, string>): McpServerConfig {
    return {
        command: process.execPath,
        args: [STUB],
        ...(env !== undefined ? { env } : {}),
    };
}

/** 临时目录，用完即删（测试进程自己起的东西自己收） */
const tempDirs: string[] = [];
function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'acode-mcp-test-'));
    tempDirs.push(dir);
    return dir;
}

/** 已经建立过、需要善后的连接 */
const opened: McpConnectionSet[] = [];

afterEach(async () => {
    // close 幂等：用例自己关过的会在里面直接返回
    for (const set of opened.splice(0)) await set.close();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function context(): ToolContext {
    return {
        workspaceRoot: tmpdir(),
        allowedPaths: [],
        runId: 'test-run',
        requestApproval: async () => 'approve',
    };
}

/** ToolParams 只声明了 _version，测试里传的是远端工具的任意参数，这里统一成参数对象 */
function params(value: Record<string, unknown>): ToolParams {
    return value as unknown as ToolParams;
}

function toolNamed(set: McpConnectionSet, name: string): McpConnectionSet['tools'][number] {
    const tool = set.tools.find((candidate) => candidate.name === name);
    if (tool === undefined) {
        throw new Error(`工具 ${name} 不在注册结果里：${set.tools.map((item) => item.name).join(', ')}`);
    }
    return tool;
}

/** process.kill(pid, 0) 是「只探不杀」：进程在就返回，没了抛 ESRCH */
function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // EPERM 说明进程还在，只是不属于当前用户
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}

/** 轮询等待一个条件成立；不用 sleep 死等，进程退得快时立刻返回 */
async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return true;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return predicate();
}

describe('连接与工具注册', () => {
    it('握手成功后列出全部工具，名字按 mcp__<server>__<tool> 命名空间化', async () => {
        const set = await connectMcpServers({ stub: stubConfig() });
        opened.push(set);

        expect(set.failures).toEqual([]);
        expect(set.servers).toEqual(['stub']);
        expect(set.tools.map((tool) => tool.name).sort()).toEqual([
            'mcp__stub__bare',
            'mcp__stub__echo',
            'mcp__stub__fail',
            'mcp__stub__hang',
            'mcp__stub__rich',
        ]);
        expect(set.connections[0]?.tools.map((tool) => tool.remote)).toContain('echo');
    });

    it('描述里带上来源 server，让模型知道这是外部能力', async () => {
        const set = await connectMcpServers({ stub: stubConfig() });
        opened.push(set);

        const echo = toolNamed(set, 'mcp__stub__echo');
        expect(echo.description).toContain('stub');
        expect(echo.description).toContain('echo');
    });

    it('远端没给 inputSchema 时退化成「任意对象」，描述缺失也不炸', async () => {
        const set = await connectMcpServers({ stub: stubConfig() });
        opened.push(set);

        const bare = toolNamed(set, 'mcp__stub__bare');
        expect(bare.getSchema()).toEqual({ type: 'object', properties: {} });
        expect(bare.description).toContain('没有提供描述');
    });

    it('工具的 JSON Schema 原样来自远端', async () => {
        const set = await connectMcpServers({ stub: stubConfig() });
        opened.push(set);

        const echo = toolNamed(set, 'mcp__stub__echo');
        const schema = echo.getSchema() as { properties?: Record<string, unknown> };
        expect(Object.keys(schema.properties ?? {})).toEqual(['text']);
    });

    it('只读声明免除审批，其余一律先问一声；四个权限位都不替远端担保', async () => {
        const set = await connectMcpServers({ stub: stubConfig() });
        opened.push(set);

        expect(toolNamed(set, 'mcp__stub__echo').permissions).toEqual({
            readsFiles: false,
            writesFiles: false,
            runsShell: false,
            // annotations.readOnlyHint === true
            requiresApproval: false,
        });
        expect(toolNamed(set, 'mcp__stub__fail').permissions.requiresApproval).toBe(true);
    });

    it('跟完 tools/list 的 nextCursor 分页，一页一个也取全', async () => {
        const set = await connectMcpServers({ stub: stubConfig({ STUB_PAGE_SIZE: '1' }) });
        opened.push(set);

        expect(set.tools).toHaveLength(5);
        expect(set.tools.map((tool) => tool.name)).toContain('mcp__stub__bare');
    });

    it('远端一直说「还有下一页」时有刹车，且截断这件事说出来', async () => {
        const logs: string[] = [];
        const set = await connectMcpServers(
            { stub: stubConfig({ STUB_ALWAYS_MORE: '1' }) },
            { onLog: (_server, line) => logs.push(line) },
        );
        opened.push(set);

        // 不刹车就是死循环；刹车了但不说，用户只会看到「工具少了一部分」
        expect(set.tools).toHaveLength(5);
        expect(logs.some((line) => line.includes('分页超过'))).toBe(true);
    });

    it('server 的 stderr 逐行交回调用方，不写进本地任何输出', async () => {
        const logs: { server: string; line: string }[] = [];
        const set = await connectMcpServers(
            { stub: stubConfig() },
            { onLog: (server, line) => logs.push({ server, line }) },
        );
        opened.push(set);

        // stub 启动时会往 stderr 打一行；stderr 与握手是两条独立的管道，
        // 到达时间不保证，所以轮询等它而不是 sleep 一个固定值
        const arrived = await waitUntil(() => logs.length > 0, 2_000);
        expect(arrived).toBe(true);
        expect(logs[0]?.server).toBe('stub');
        expect(logs[0]?.line).toContain('MCP stub');
    });

    it('配置为空时不连任何东西，也不报失败', async () => {
        const set = await connectMcpServers({});
        opened.push(set);

        expect(set.tools).toEqual([]);
        expect(set.servers).toEqual([]);
        expect(set.failures).toEqual([]);
    });

    it('从 .acode/mcp.json 读到的配置能直接连上', async () => {
        const dir = makeTempDir();
        mkdirSync(join(dir, '.acode'), { recursive: true });
        writeFileSync(
            mcpConfigFile(dir),
            JSON.stringify({ mcpServers: { fromfile: stubConfig() } }),
            'utf8',
        );

        const config = loadMcpConfig(dir);
        expect(config.error).toBeNull();

        const set = await connectMcpServers(config.servers);
        opened.push(set);

        expect(set.servers).toEqual(['fromfile']);
        expect(set.tools.map((tool) => tool.name)).toContain('mcp__fromfile__echo');
    });
});

describe('工具调用', () => {
    it('调用成功时正文原样拿得到', async () => {
        const set = await connectMcpServers({ stub: stubConfig() });
        opened.push(set);

        const result = await toolNamed(set, 'mcp__stub__echo').execute(params({ text: '你好' }), context());

        expect(result.success).toBe(true);
        expect(result.data).toContain('echo: 你好');
        expect(result.display).toContain('echo');
    });

    it('远端 isError: true 变成 success: false，正文进 error', async () => {
        const set = await connectMcpServers({ stub: stubConfig() });
        opened.push(set);

        const result = await toolNamed(set, 'mcp__stub__fail').execute(params({}), context());

        expect(result.success).toBe(false);
        expect(result.data).toBeNull();
        // error 就是远端的正文（规格如此：正文进 error），指向哪个工具靠 display
        expect(result.error).toBe('boom: 远端工具报告失败');
        expect(result.display).toContain('fail');
    });

    it('调用一个远端不存在的工具，得到指明工具的失败而不是异常', async () => {
        const client = await McpClient.connect('stub', stubConfig());
        try {
            const ghost = new McpTool({ server: 'stub', remoteName: 'nope', client });

            const result = await ghost.execute(params({}), context());

            expect(result.success).toBe(false);
            expect(result.error).toContain('nope');
            expect(result.error).toContain('Unknown tool');
        } finally {
            await client.close();
        }
    });

    it('非对象参数在本地就被挡下，不发往远端', async () => {
        const set = await connectMcpServers({ stub: stubConfig() });
        opened.push(set);

        const echo = toolNamed(set, 'mcp__stub__echo');
        expect(echo.validate('不是对象').valid).toBe(false);
        expect(echo.validate([1, 2]).valid).toBe(false);
        expect(echo.validate({ text: 'x' }).valid).toBe(true);
    });

    it('远端不响应时按请求超时失败，不会永远挂着', async () => {
        const set = await connectMcpServers({ stub: stubConfig() }, { requestTimeoutMs: 300 });
        opened.push(set);

        const started = Date.now();
        const result = await toolNamed(set, 'mcp__stub__hang').execute(params({}), context());

        expect(result.success).toBe(false);
        expect(result.error).toContain('超时');
        expect(Date.now() - started).toBeLessThan(5_000);
    });
});

describe('隔离与收尾', () => {
    it('一个 server 起不来，不影响另一个，且失败原因被记下来', async () => {
        const set = await connectMcpServers({
            broken: { command: 'acode-command-that-does-not-exist-mcp-test' },
            stub: stubConfig(),
        });
        opened.push(set);

        expect(set.servers).toEqual(['stub']);
        expect(set.failures).toHaveLength(1);
        expect(set.failures[0]?.server).toBe('broken');
        expect(set.failures[0]?.message).toContain('启动');
        // 失败的那个不该顺走任何工具或连接
        expect(set.tools.map((tool) => tool.name)).toContain('mcp__stub__echo');
        expect(set.connections.map((connection) => connection.server)).toEqual(['stub']);
    });

    it('连接失败也会通过 onError 报出来', async () => {
        const errors: { server: string; message: string }[] = [];
        const set = await connectMcpServers(
            { broken: { command: 'acode-command-that-does-not-exist-mcp-test' } },
            { onError: (server, message) => errors.push({ server, message }) },
        );
        opened.push(set);

        expect(errors).toHaveLength(1);
        expect(errors[0]?.server).toBe('broken');
    });

    it('close() 之后子进程确实没了', async () => {
        const set = await connectMcpServers({ stub: stubConfig() });

        const echoed = await toolNamed(set, 'mcp__stub__echo')
            .execute(params({ text: 'pid' }), context());
        const pid = Number(/pid: (\d+)/.exec(String(echoed.data))?.[1]);

        expect(Number.isInteger(pid)).toBe(true);
        expect(isAlive(pid)).toBe(true);

        await set.close();

        expect(await waitUntil(() => !isAlive(pid), 8_000)).toBe(true);
    });

    it('close() 可以重复调用', async () => {
        const set = await connectMcpServers({ stub: stubConfig() });
        await set.close();
        await expect(set.close()).resolves.toBeUndefined();
    });

    it('子进程退出后，在途请求立刻以「连接已断开」失败', async () => {
        const client = await McpClient.connect('stub', stubConfig());

        // 起一个不会被响应的请求，再让进程退出：不处理的话它会一直挂到超时
        const hanging = new McpTool({ server: 'stub', remoteName: 'hang', client })
            .execute(params({}), context());

        await client.close();

        const result = await Promise.race([
            hanging,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('请求没有被断开')), 5_000)),
        ]);

        expect(result.success).toBe(false);
        expect(result.error).toContain('断开');
    });
});

describe('工具命名', () => {
    it('非法字符替换成下划线', () => {
        expect(mcpToolName('my server', 'read.file')).toBe('mcp__my_server__read_file');
        // 一个非 ASCII 字符替换成一个下划线（'服务' → '__'），不是整段折叠
        expect(mcpToolName('服务', '工具')).toBe('mcp________');
    });

    it('撞名时加数字后缀，不覆盖前一个', () => {
        const used = new Set<string>();
        expect(uniqueMcpToolName('s', 'a.b', used)).toBe('mcp__s__a_b');
        expect(uniqueMcpToolName('s', 'a_b', used)).toBe('mcp__s__a_b_2');
        expect(uniqueMcpToolName('s', 'a_b', used)).toBe('mcp__s__a_b_3');
    });
});

describe('非文本内容', () => {
    it('image / resource 折成占位说明，正文里不出现 base64', async () => {
        const set = await connectMcpServers({ stub: stubConfig() });
        opened.push(set);

        const result = await toolNamed(set, 'mcp__stub__rich').execute(params({}), context());
        const text = String(result.data);

        expect(result.success).toBe(true);
        expect(text).toContain('rich ok');
        expect(text).toContain('[image: image/png, 11.7KB]');
        expect(text).toContain('[resource: file:///tmp/report.txt (text/plain)]');
        expect(text).not.toContain('AAAA');
    });

    it('未知内容类型也有占位，不会被静默丢掉', () => {
        expect(renderContent([{ type: 'video', data: 'x' }])).toBe('[video: 该内容类型无法在此展示]');
        expect(renderContent([])).toBe('');
    });
});

describe('配置解析', () => {
    it('文件不存在 = 没有配置，不是错误', () => {
        const dir = makeTempDir();

        const config = loadMcpConfig(dir);

        expect(config.file).toBe(join(dir, '.acode', 'mcp.json'));
        expect(config.servers).toEqual({});
        expect(config.error).toBeNull();
    });

    it('JSON 坏掉时给出可读错误，且不抛异常', () => {
        const dir = makeTempDir();
        mkdirSync(join(dir, '.acode'), { recursive: true });
        writeFileSync(mcpConfigFile(dir), '{ "mcpServers": {', 'utf8');

        const config = loadMcpConfig(dir);

        expect(config.servers).toEqual({});
        expect(config.error).toContain('不是合法的 JSON');
        expect(config.error).toContain(mcpConfigFile(dir));
    });

    it('顶层不是对象、缺 mcpServers 都报明确错误', () => {
        const dir = makeTempDir();
        mkdirSync(join(dir, '.acode'), { recursive: true });

        writeFileSync(mcpConfigFile(dir), '"just a string"', 'utf8');
        expect(loadMcpConfig(dir).error).toContain('顶层必须是一个 JSON 对象');

        writeFileSync(mcpConfigFile(dir), '{}', 'utf8');
        expect(loadMcpConfig(dir).error).toContain('缺少 mcpServers 字段');
    });

    it('字段类型不对时指出具体是哪一个', () => {
        const dir = makeTempDir();
        mkdirSync(join(dir, '.acode'), { recursive: true });

        writeFileSync(mcpConfigFile(dir), JSON.stringify({
            mcpServers: {
                bad: { args: ['x'] },
                worse: { command: 'node', env: { K: 1 } },
            },
        }), 'utf8');

        const config = loadMcpConfig(dir);

        expect(config.error).toContain('mcpServers.bad.command');
        expect(config.error).toContain('mcpServers.worse.env');
        expect(config.servers).toEqual({});
    });

    it('合法配置原样读出来，未知字段忽略', () => {
        const dir = makeTempDir();
        mkdirSync(join(dir, '.acode'), { recursive: true });
        writeFileSync(mcpConfigFile(dir), JSON.stringify({
            mcpServers: {
                ok: { command: 'node', args: ['x.mjs'], env: { K: 'v' }, cwd: '/tmp', disabled: true },
            },
        }), 'utf8');

        const config = loadMcpConfig(dir);

        expect(config.error).toBeNull();
        expect(config.servers).toEqual({
            ok: { command: 'node', args: ['x.mjs'], env: { K: 'v' }, cwd: '/tmp' },
        });
    });
});
