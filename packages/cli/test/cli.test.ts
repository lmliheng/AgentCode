// src/test/cli.test.ts
//
// 覆盖会话 CLI 的参数解析。
//
// CLI 本身要真实模型与真实工作区才能跑起来，端到端在这里测不了；但「参数怎么解」是
// 最容易出错也最值得钉住的部分 —— 尤其是 `--resume` 不带值这种合法写法，
// 以及值缺失时应该报错而不是静默当成默认值。

import { describe, it, expect } from 'vitest';

import { parseArgs } from '../src/utils/ParseArgs.js';

describe('会话 CLI 的参数解析', () => {
  it('空参数时用当前目录与默认值', () => {
    const args = parseArgs([]);

    expect(args.workspacePath).toBe(process.cwd());
    expect(args.resume).toBe(false);
    expect(args.resumeSessionId).toBeUndefined();
    expect(args.list).toBe(false);
    expect(args.task).toBeUndefined();
    expect(args.model).toBe('deepseek-chat');
    expect(args.maxIterations).toBe(50);
    expect(args.help).toBe(false);
  });

  it('位置参数是工作区路径', () => {
    const args = parseArgs(['C:\\ws']);

    expect(args.workspacePath).toBe('C:\\ws');
  });

  it('--resume 不带值是合法写法：接最近活跃的会话', () => {
    const args = parseArgs(['C:\\ws', '--resume']);

    expect(args.resume).toBe(true);
    expect(args.resumeSessionId).toBeUndefined();
    expect(args.workspacePath).toBe('C:\\ws');
  });

  it('--resume=ID 时带上会话 ID', () => {
    const args = parseArgs(['--resume=20260922-100000-aaaaaa']);

    expect(args.resume).toBe(true);
    expect(args.resumeSessionId).toBe('20260922-100000-aaaaaa');
  });

  it('选项与位置参数的先后顺序不影响结果', () => {
    const args = parseArgs(['--resume', 'C:\\ws']);

    expect(args.workspacePath).toBe('C:\\ws');
    expect(args.resume).toBe(true);
  });

  it('带空格的任务文本按一个参数收下', () => {
    const args = parseArgs(['--task', '把这个项目的测试跑通']);

    expect(args.task).toBe('把这个项目的测试跑通');
  });

  it('支持 --name=value 与 --name value 两种写法', () => {
    expect(parseArgs(['--model=deepseek-flash']).model).toBe('deepseek-flash');
    expect(parseArgs(['--model', 'deepseek-flash']).model).toBe('deepseek-flash');
    expect(parseArgs(['--max-iterations=3']).maxIterations).toBe(3);
    expect(parseArgs(['--max-iterations', '3']).maxIterations).toBe(3);
  });

  it('--list 与 --help 是开关', () => {
    expect(parseArgs(['--list']).list).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
  });

  it('--yes 默认关闭：无人值守的放行必须显式声明', () => {
    expect(parseArgs([]).yes).toBe(false);
    expect(parseArgs(['--yes']).yes).toBe(true);
    // 只管长开关：短选项在这个解析器里会被当成位置参数（工作区路径）
    expect(parseArgs(['-y']).yes).toBe(false);
  });

  it('缺值的开关直接报错，不静默用默认值', () => {
    expect(() => parseArgs(['--task'])).toThrow(/--task/);
    expect(() => parseArgs(['--model'])).toThrow(/--model/);
  });

  it('--max-tokens 是可选的正整数上限（成本闸门）', () => {
    expect(parseArgs([]).maxTokens).toBeUndefined();
    expect(parseArgs(['--max-tokens=200000']).maxTokens).toBe(200000);
    expect(parseArgs(['--max-tokens', '50000']).maxTokens).toBe(50000);
    expect(() => parseArgs(['--max-tokens', '0'])).toThrow(/正整数/);
    expect(() => parseArgs(['--max-tokens', 'abc'])).toThrow(/正整数/);
  });

  it('--output-format 默认 text，只认三种取值', () => {
    expect(parseArgs(['--task', 'x']).outputFormat).toBe('text');
    expect(parseArgs(['--task', 'x', '--output-format', 'json']).outputFormat).toBe('json');
    expect(parseArgs(['--task', 'x', '--output-format=stream-json']).outputFormat).toBe('stream-json');
    expect(() => parseArgs(['--task', 'x', '--output-format', 'yaml'])).toThrow(/output-format/);
  });

  it('--provider 默认 deepseek，只认已实现的协议族', () => {
    expect(parseArgs([]).provider).toBe('deepseek');
    expect(parseArgs(['--provider', 'openai']).provider).toBe('openai');
    expect(parseArgs(['--provider=openai']).provider).toBe('openai');
    // 写错不能被当成默认值：用户会以为已经切过去了，实际还在打 DeepSeek
    expect(() => parseArgs(['--provider', 'anthorpic'])).toThrow(/--provider/);
  });

  it('--base-url 默认不传（用提供方自己的端点），空值报错', () => {
    expect(parseArgs([]).baseUrl).toBeUndefined();
    expect(parseArgs(['--base-url', 'http://127.0.0.1:8000/v1/chat/completions']).baseUrl)
      .toBe('http://127.0.0.1:8000/v1/chat/completions');
    expect(() => parseArgs(['--base-url', ''])).toThrow(/base-url/);
  });

  it('--output-format 只在一次性模式下成立，不静默忽略', () => {
    // 交互模式没有「一次运行的结果」可序列化；静默忽略会让人以为拿到了结构化产物
    expect(() => parseArgs(['--output-format', 'json'])).toThrow(/--task/);
    // text 是默认值，与 --task 无关，不该被这条规则拦下
    expect(parseArgs(['--output-format', 'text']).outputFormat).toBe('text');
  });

  it('循环上限必须是正整数', () => {
    expect(() => parseArgs(['--max-iterations', '0'])).toThrow(/正整数/);
    expect(() => parseArgs(['--max-iterations', 'abc'])).toThrow(/正整数/);
  });
});
