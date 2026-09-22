

import type { CliArgs } from '../types/Args.js'

/** 需要接值的开关：写成 --name value 与 --name=value 两种都认 */
const VALUE_FLAGS = new Set(['--task', '--model', '--max-iterations']);


export function parseArgs(argv: readonly string[]): CliArgs {
  const positional: string[] = [];
  const values = new Map<string, string>();
  const switches = new Set<string>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;

    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq === -1 ? arg : arg.slice(0, eq);

      if (eq !== -1) {
        values.set(name, arg.slice(eq + 1));
        continue;
      }
      if (VALUE_FLAGS.has(name)) {
        const next = argv[i + 1];
        if (next === undefined) throw new Error(`${name} 后面需要跟一个值`);
        values.set(name, next);
        i += 1;
        continue;
      }
      switches.add(name);
      continue;
    }

    positional.push(arg);
  }

  const maxIterations = Number(values.get('--max-iterations') ?? 50);
  if (!Number.isInteger(maxIterations) || maxIterations < 1) {
    throw new Error('--max-iterations 必须是正整数');
  }

  return {
    workspacePath: positional[0] ?? process.cwd(),
    // --resume 不带值也成立，所以它在 values 里存在即为指定了会话 ID
    resume: switches.has('--resume') || values.has('--resume'),
    resumeSessionId: values.get('--resume'),
    list: switches.has('--list'),
    task: values.get('--task'),
    model: values.get('--model') ?? 'deepseek-chat',
    maxIterations,
    help: switches.has('--help') || switches.has('-h'),
    dev: switches.has('--dev'),
  };
}