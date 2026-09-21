// src/test/cli.test.ts
//
// 覆盖会话 CLI 的参数解析。
//
// CLI 本身要真实模型与真实工作区才能跑起来，端到端在这里测不了；但「参数怎么解」是
// 最容易出错也最值得钉住的部分 —— 尤其是 `--resume` 不带值这种合法写法，
// 以及值缺失时应该报错而不是静默当成默认值。

import { describe, it, expect } from 'vitest';

import { parseArgs } from './cli.js';

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

  it('缺值的开关直接报错，不静默用默认值', () => {
    expect(() => parseArgs(['--task'])).toThrow(/--task/);
    expect(() => parseArgs(['--model'])).toThrow(/--model/);
  });

  it('循环上限必须是正整数', () => {
    expect(() => parseArgs(['--max-iterations', '0'])).toThrow(/正整数/);
    expect(() => parseArgs(['--max-iterations', 'abc'])).toThrow(/正整数/);
  });
});
