// src/project-instructions.ts
//
// 工作区指令文件：让用户能给一个项目写「本项目的规矩」，而不是每条任务都重述一遍。
//
// 这是编码 agent 的通用约定（Claude Code 的 CLAUDE.md、各家工具的 AGENTS.md），
// 在此之前 acode 的系统提示是代码里拼死的固定文本，用户没有任何注入点。

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 识别顺序：越靠前越优先。
 *
 * 同时存在多份时只认第一份 —— 加载几份可能相互矛盾的规矩，比没有规矩更难排查，
 * 而且每一份都要占掉每次请求的输入量。要「合并多份」应该由用户自己在一份里写清。
 */
export const PROJECT_INSTRUCTION_FILES = ['ACODE.md', 'AGENTS.md', 'CLAUDE.md'] as const;

/**
 * 送进提示词的体量上限（字符）。
 *
 * 指令文件由用户写，长度不可控；一份几万字的文件会把这个前缀的输入成本抬起来，
 * 而它每次请求都要重发。超过就截断，并在提示词里注明被截断了。
 */
export const MAX_PROJECT_INSTRUCTION_CHARS = 12_000;

export interface ProjectInstructions {
    /** 文件名（相对工作区） */
    file: string;
    /** 绝对路径，用于在提示词里说明来路 */
    path: string;
    /** 送进提示词的内容（可能已截断） */
    content: string;
    truncated: boolean;
}

/**
 * 读取工作区的指令文件，没有就返回 null。
 *
 * 空文件按「没有」处理：一个空的 ACODE.md 不该在提示词里留下一段无内容的标题，
 * 那只会占位置并让模型以为那里本来该有东西。
 */
export function loadProjectInstructions(workspacePath: string): ProjectInstructions | null {
    for (const file of PROJECT_INSTRUCTION_FILES) {
        const full = join(workspacePath, file);
        if (!existsSync(full)) continue;

        try {
            if (!statSync(full).isFile()) continue;
            const raw = readFileSync(full, 'utf-8').trim();
            if (raw === '') continue;

            const truncated = raw.length > MAX_PROJECT_INSTRUCTION_CHARS;
            return {
                file,
                path: full,
                content: truncated ? raw.slice(0, MAX_PROJECT_INSTRUCTION_CHARS) : raw,
                truncated,
            };
        } catch (error) {
            // 读不了就当没有：一份读不动的指令文件不该让整个任务起不来
            console.warn(`[AgentRuntime] 读取工作区指令 ${file} 失败，已忽略：${(error as Error).message}`);
        }
    }

    return null;
}

/**
 * 渲染成系统提示里的一段。
 *
 * 明确写出「本项目的规矩优先于上面的通用工作方式」：两边冲突时（例如项目要求
 * 提交信息用中文、而通用部分没提），模型需要一个裁决顺序，否则它会挑一个顺手的。
 */
export function formatProjectInstructions(instructions: ProjectInstructions): string {
    const truncatedNote = instructions.truncated
        ? `\n\n（文件超过 ${MAX_PROJECT_INSTRUCTION_CHARS} 字符，以上为截断后的内容）`
        : '';

    return `工作区指令（${instructions.file}，来自 ${instructions.path}）：
这份由用户为本项目写下的规矩优先于上面的通用工作方式；与任务描述冲突时以任务描述为准。

${instructions.content}${truncatedNote}`;
}
