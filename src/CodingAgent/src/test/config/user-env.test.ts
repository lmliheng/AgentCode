// src/test/config/user-env.test.ts
//
// 用户级 .env 的加载规则。
//
// 重点是「环境变量优先」：它决定 CI 或脚本里显式传的 key 会不会被家目录里的旧值
// 悄悄盖掉 —— 那是最难查的一类问题，所以要有用例钉住。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadUserEnvFile } from '../../config/user-env.js';
import {
    ENV_FILE_ENV,
    agentcodeHome,
    sessionsRoot,
    userEnvFile,
} from '../../persistence/paths.js';

const KEY = 'DEEPSEEK_API_KEY';

describe('用户级 .env 的加载', () => {
    let dir: string;
    let envFile: string;
    let saved: string | undefined;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'acode-env-'));
        envFile = join(dir, '.env');
        saved = process.env[KEY];
        delete process.env[KEY];
    });

    afterEach(() => {
        if (saved === undefined) delete process.env[KEY];
        else process.env[KEY] = saved;
        rmSync(dir, { recursive: true, force: true });
    });

    it('文件里有 key 时读进来', () => {
        writeFileSync(envFile, `${KEY}=from-file\n`, 'utf-8');

        loadUserEnvFile(envFile);

        expect(process.env[KEY]).toBe('from-file');
    });

    it('环境变量已给出时文件不生效', () => {
        writeFileSync(envFile, `${KEY}=from-file\n`, 'utf-8');
        process.env[KEY] = 'from-env';

        loadUserEnvFile(envFile);

        expect(process.env[KEY]).toBe('from-env');
    });

    it('文件不存在时不抛错，也不设值', () => {
        expect(() => loadUserEnvFile(envFile)).not.toThrow();
        expect(process.env[KEY]).toBeUndefined();
    });

    it('文件读不动时只告警，不打断命令', () => {
        // 拿一个目录当文件：路径存在，但读它会抛
        const notAFile = join(dir, 'a-directory');
        mkdirSync(notAFile);

        const warnings: string[] = [];
        const spy = vi.spyOn(console, 'warn').mockImplementation((message?: unknown) => {
            warnings.push(String(message));
        });
        try {
            expect(() => loadUserEnvFile(notAFile)).not.toThrow();
        } finally {
            spy.mockRestore();
        }

        // 不能静默：读不动和「没有这份配置」不是一回事
        expect(warnings.some(line => line.includes('读取失败'))).toBe(true);
        expect(process.env[KEY]).toBeUndefined();
    });
});

describe('用户级配置的位置', () => {
    it('默认取家目录下的 .agentcode', () => {
        expect(userEnvFile()).toBe(join(agentcodeHome(), '.env'));
    });

    it('可用 AGENTCODE_ENV_FILE 覆盖', () => {
        const saved = process.env[ENV_FILE_ENV];
        process.env[ENV_FILE_ENV] = join('D:', 'tmp', 'custom.env');
        try {
            expect(userEnvFile()).toBe(join('D:', 'tmp', 'custom.env'));
        } finally {
            if (saved === undefined) delete process.env[ENV_FILE_ENV];
            else process.env[ENV_FILE_ENV] = saved;
        }
    });

    it('会话目录与配置同源，都在家目录下', () => {
        // 目录名只由 agentcodeHome() 提供一处；这条同时钉住那次重构没改变行为
        expect(sessionsRoot()).toBe(join(agentcodeHome(), 'sessions'));
    });
});
