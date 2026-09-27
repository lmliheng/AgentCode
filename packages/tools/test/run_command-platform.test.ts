// run_command 的平台适配：描述跟着实际平台走，输出解码按平台选编码。
//
// 对应 run_test/PRD.md §5：四份 trace 里都出现过中文乱码（`'ls' 不是内部或外部命令`
// 被按 UTF-8 解成 `'ls' �����ڲ����ⲿ���Ҳ���Ǵ����еĳ���`），另外描述写死
// 「当前是 Windows」，在 Linux/macOS 上把模型带向错误的命令写法。

import { describe, expect, it } from 'vitest';
import { RunCommandTool, decodeOutput, describeRunCommand } from '../src/run_command.js';

/** cmd.exe 输出「系统找不到指定的路径。」的 GBK 字节（实测解码结果见用例断言） */
const GBK_SYSTEM_PATH_NOT_FOUND = Buffer.from(
    'CFB5CDB3D5D2B2BBB5BDD6B8B6A8B5C4C2B7BEB6A1A3',
    'hex',
);

describe('run_command 的平台适配', () => {
    describe('工具描述', () => {
        it('Windows 上说明是 cmd.exe 及其限制', () => {
            const description = describeRunCommand('win32');
            expect(description).toContain('cmd.exe');
            expect(description).toContain('不支持 ; 分隔');
        });

        it('类 Unix 上说明是 /bin/sh，且不再出现「当前是 Windows」', () => {
            const description = describeRunCommand('linux');
            expect(description).toContain('/bin/sh');
            expect(description).not.toContain('cmd.exe');
            expect(description).not.toContain('当前是 Windows');
            // POSIX 的串联语义要讲清楚，否则模型会按 cmd 的直觉写
            expect(description).toContain('&&');
        });

        it('实例上的描述与当前平台一致', () => {
            expect(new RunCommandTool().description).toBe(describeRunCommand(process.platform));
        });
    });

    describe('输出解码', () => {
        it('UTF-8 输出在任何平台都原样返回', () => {
            const bytes = Buffer.from('系统找不到指定的路径。', 'utf-8');
            expect(decodeOutput(bytes, 'win32')).toBe('系统找不到指定的路径。');
            expect(decodeOutput(bytes, 'linux')).toBe('系统找不到指定的路径。');
        });

        it('Windows 上把 GBK 输出解成可读中文（原来按 UTF-8 解是乱码）', () => {
            // 先钉住前提：这串字节按 UTF-8 解确实是乱码
            expect(GBK_SYSTEM_PATH_NOT_FOUND.toString('utf-8')).toContain('\uFFFD');

            expect(decodeOutput(GBK_SYSTEM_PATH_NOT_FOUND, 'win32')).toBe('系统找不到指定的路径。');
        });

        it('非 Windows 平台不做 GBK 猜测（那里的输出本来就该是 UTF-8）', () => {
            expect(decodeOutput(GBK_SYSTEM_PATH_NOT_FOUND, 'linux')).toContain('\uFFFD');
        });
    });
});
