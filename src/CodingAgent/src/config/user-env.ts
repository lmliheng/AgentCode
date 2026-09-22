// src/config/user-env.ts
//
// 用户级 .env 的加载。
//
// 为什么需要它：全局安装后命令由 npm 的 shim 直接执行，没有 npm script 帮忙传
// `--env-file`；而 `--env-file=` 是相对**当前工作目录**解析的，用户在任意目录下
// 敲命令时那里根本没有这个文件。所以加载得自己做，位置固定在用户级目录
// （见 paths.ts 的 userEnvFile）。
//
// 注意 process.loadEnvFile 会把文件里的**所有**键写进 process.env，不只是本
// 应用认识的那几个 —— 所以那个文件只该放配置。

import { existsSync } from 'node:fs';
import { userEnvFile } from '../persistence/paths.js';

/**
 * 本应用从用户级 .env 读取的键。
 *
 * 列出来是为了定义「环境变量优先」的判据：这些键只要都已由环境变量给出，就
 * 连文件都不必打开。
 */
const KEYS_FROM_USER_ENV = ['DEEPSEEK_API_KEY'] as const;

/**
 * 加载用户级 .env，把本应用用到、而环境变量里还没有的键补上。
 *
 * 规则是**环境变量优先**：文件里的值只在环境变量没给的时候才生效。否则 CI 或
 * 脚本里显式传的 key 会被家目录里的旧值悄悄盖掉 —— 那是最难查的一类问题。
 * 实现上靠「都已给出就提前返回」来保证，而不是依赖 loadEnvFile 对已存在变量的
 * 覆盖行为（那个行为随版本变，不能拿它当契约）。
 *
 * 文件不存在、或读不动，都只是「没有这份配置」：这里不抛错，把判断留给真正
 * 需要 key 的地方，由它报出「key 该放哪」的明确提示。
 */
export function loadUserEnvFile(filePath?: string): void {
  const target = userEnvFile(filePath);

  const allProvided = KEYS_FROM_USER_ENV.every(key => process.env[key] !== undefined);
  if (allProvided) return;

  if (!existsSync(target)) return;

  try {
    process.loadEnvFile(target);
  } catch (error) {
    console.warn(
      `[acode] 用户级环境文件读取失败（${target}）：${(error as Error).message}`,
    );
  }
}
