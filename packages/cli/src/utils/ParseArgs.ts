

import type { CliArgs, OutputFormat, ProviderName } from '@lmliheng/acode-core'

/** 需要接值的开关：写成 --name value 与 --name=value 两种都认 */
const VALUE_FLAGS = new Set([
  '--task', '--model', '--provider', '--base-url', '--max-iterations', '--max-tokens', '--output-format',
]);

const PROVIDERS: readonly ProviderName[] = ['deepseek', 'openai'];

const OUTPUT_FORMATS: readonly OutputFormat[] = ['text', 'json', 'stream-json'];


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

  const maxTokensRaw = values.get('--max-tokens');
  const maxTokens = maxTokensRaw === undefined ? undefined : Number(maxTokensRaw);
  if (maxTokens !== undefined && (!Number.isInteger(maxTokens) || maxTokens < 1)) {
    throw new Error('--max-tokens 必须是正整数');
  }

  // 提供方先校验：模型名与密钥都要按它取，写错了却当成默认值，用户会以为切过去了
  const providerRaw = values.get('--provider') ?? 'deepseek';
  if (!PROVIDERS.includes(providerRaw as ProviderName)) {
    throw new Error(`--provider 只能是 ${PROVIDERS.join(' / ')}（openai 指 /chat/completions 协议，可配 --base-url 指向兼容端点）`);
  }
  const provider = providerRaw as ProviderName;

  const baseUrl = values.get('--base-url');
  if (baseUrl !== undefined && baseUrl.trim() === '') {
    throw new Error('--base-url 不能是空字符串');
  }

  const outputFormatRaw = values.get('--output-format') ?? 'text';
  if (!OUTPUT_FORMATS.includes(outputFormatRaw as OutputFormat)) {
    throw new Error(`--output-format 只能是 ${OUTPUT_FORMATS.join(' / ')}`);
  }
  const outputFormat = outputFormatRaw as OutputFormat;

  // 结构化输出只对一次性模式有意义：交互模式下没有「一次运行的结果」可以序列化，
  // 静默忽略会让人以为拿到了结构化产物 —— 直接报错，别让它成为一个不会生效的开关。
  if (outputFormat !== 'text' && !values.has('--task')) {
    throw new Error('--output-format 只与 --task 一起用（一次性跑完才有可序列化的结果）');
  }

  return {
    workspacePath: positional[0] ?? process.cwd(),
    // --resume 不带值也成立，所以它在 values 里存在即为指定了会话 ID
    resume: switches.has('--resume') || values.has('--resume'),
    resumeSessionId: values.get('--resume'),
    list: switches.has('--list'),
    task: values.get('--task'),
    model: values.get('--model') ?? 'deepseek-chat',
    provider,
    baseUrl,
    maxIterations,
    maxTokens,
    outputFormat,
    yes: switches.has('--yes'),
    help: switches.has('--help') || switches.has('-h'),
    dev: switches.has('--dev'),
  };
}