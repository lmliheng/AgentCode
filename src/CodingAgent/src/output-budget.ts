import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 工具输出的统一体量口径（见 design.md D1-D5）。
 *
 * 这个模块只做一件事：把一段要送入模型的文本收进预算之内。它不关心工具语义，
 * 也不关心消息序列 —— 那些分别属于工具自身与运行时。
 */

/**
 * 单个工具声明的输出预算。
 *
 * 两个维度同时生效：只限字符会被「行数极多但每行很短」的输出绕过
 * （如 `find /`、`ls -R`）。
 */
export interface OutputBudget {
    /** 字符上限。设为 <= 0 表示关闭字符限制 */
    maxChars?: number;
    /**
     * 行数上限。设为 Number.POSITIVE_INFINITY 表示不限行 ——
     * 工具只想按字符约束时这样写，避免被全局行数上限削掉自身预算。
     */
    maxLines?: number;
}

/** 未声明预算的工具所适用的全局默认 */
export interface GlobalOutputBudget {
    maxChars: number;
    maxLines: number;
}

/**
 * 全局默认预算。
 *
 * 字符上限沿用 read_file 已有的 8000 量级，以避免引入新的数量级；
 * 行数上限取 500，用于覆盖「大量短行」类输出（只靠字符上限挡不住）。
 * 两者都是可调整项，不写入 spec。
 */
export const DEFAULT_OUTPUT_BUDGET: GlobalOutputBudget = {
    maxChars: 8000,
    maxLines: 500,
};

/** 截断标记：既用于告知模型，也用于幂等判断 */
export const TRUNCATION_MARKER = '... [CONTENT TRUNCATED] ...';

/** 成功但没有任何输出内容时的占位说明 */
export const NO_OUTPUT_PLACEHOLDER = '(工具执行完成，无输出)';

/** 已截断的内容的识别前缀（与工具运行时约定的持久化标记一致） */
const PERSISTED_PREFIX = '<persisted-output>';

/**
 * 判断内容是否已经过截断处理。
 *
 * 两级兜底（工具内 + 运行时）意味着同一段内容可能被处理两次，
 * 靠这个判断保证第二次是无副作用的 no-op。
 */
export function isAlreadyTruncated(content: string): boolean {
    return content.includes(TRUNCATION_MARKER) || content.startsWith(PERSISTED_PREFIX);
}

export interface BudgetOutcome {
    /** 收进预算后的内容 */
    content: string;
    /** 是否发生过截断 */
    truncated: boolean;
    /** 处理前的原始长度 */
    originalLength: number;
    /** 完整内容的落盘位置；未截断时不存在 */
    fullOutputPath?: string;
}

export interface ApplyOutputBudgetOptions {
    /** 工具名，用于落盘文件的命名 */
    toolName: string;
    /** 工作区根：落盘位置必须位于它之外 */
    workspaceRoot: string;
    /** 工具声明的预算；未声明时用全局默认 */
    budget?: OutputBudget;
    /** 全局默认，默认取 DEFAULT_OUTPUT_BUDGET */
    global?: GlobalOutputBudget;
}

/**
 * 把内容收进预算。
 *
 * 规则（见 design.md）：
 *   - 空白内容 -> 明确占位，而不是空字符串
 *   - 已截断 -> 原样返回，不产生嵌套标记
 *   - 上限 <= 0 -> 视为关闭
 *   - 超出任一一维 -> 保留首尾两端，中间标出省略；完整内容外部化落盘
 */
export function applyOutputBudget(content: string, options: ApplyOutputBudgetOptions): BudgetOutcome {
    const originalLength = content.length;

    if (content.trim() === '') {
        return { content: NO_OUTPUT_PLACEHOLDER, truncated: false, originalLength };
    }

    if (isAlreadyTruncated(content)) {
        return { content, truncated: true, originalLength };
    }

    const global = options.global ?? DEFAULT_OUTPUT_BUDGET;
    const maxChars = options.budget?.maxChars ?? global.maxChars;
    const maxLines = options.budget?.maxLines ?? global.maxLines;

    // 任一维上限被设为 <= 0 即视为显式关闭
    if (maxChars <= 0 || maxLines <= 0) {
        return { content, truncated: false, originalLength };
    }

    const lineCount = content.split('\n').length;
    const overChars = content.length > maxChars;
    // maxLines 为 Infinity 时 Number.isFinite 为 false，即只受字符维度约束
    const overLines = Number.isFinite(maxLines) && lineCount > maxLines;

    if (!overChars && !overLines) {
        return { content, truncated: false, originalLength };
    }

    const fullOutputPath = persistFullOutput(content, options.toolName, options.workspaceRoot);
    const truncatedContent = keepBothEnds(content, maxChars, maxLines);

    return { content: truncatedContent, truncated: true, originalLength, fullOutputPath };
}

/**
 * 截断时保留首尾两端。
 *
 * 失败摘要通常在输出的尾部（命令尤其如此），只保头部会把最该看的信息切掉。
 */
function keepBothEnds(content: string, maxChars: number, maxLines: number): string {
    let text = content;

    // 1) 行维度
    if (Number.isFinite(maxLines) && maxLines > 0) {
        const lines = text.split('\n');
        if (lines.length > maxLines) {
            const headCount = Math.ceil(maxLines / 2);
            const tailCount = Math.max(0, Math.floor(maxLines / 2) - 1); // 给标记行让位
            const omitted = Math.max(0, lines.length - headCount - tailCount);
            text = [
                ...lines.slice(0, headCount),
                `${TRUNCATION_MARKER} (省略 ${omitted} 行) ${TRUNCATION_MARKER}`,
                ...(tailCount > 0 ? lines.slice(lines.length - tailCount) : []),
            ].join('\n');
        }
    }

    // 2) 字符维度
    if (maxChars > 0 && text.length > maxChars) {
        const reserve = 80; // 标记自身的预留长度
        const budget = Math.max(0, maxChars - reserve);
        const head = Math.ceil(budget / 2);
        const tail = Math.max(0, budget - head);
        const omitted = Math.max(0, text.length - head - tail);
        const marker = `\n${TRUNCATION_MARKER} (省略 ${omitted} 字符) ${TRUNCATION_MARKER}\n`;
        text = text.slice(0, head) + marker + (tail > 0 ? text.slice(text.length - tail) : '');
    }

    return text;
}

/**
 * 完整内容落盘。
 *
 * 位置放在工作区**之外**：工作区内会被 git_operation 暂存、被 read_directory
 * 列出、被 search_code 搜到，临时文件会污染这些工具的自身结果。
 *
 * 文件名取内容摘要，**不能带随机量**：这个路径会被写进工具结果、进入模型的
 * 上下文，而工具结果消息每轮都要从观察重新派生一次。随机文件名会让同一段历史
 * 每轮长得都不一样，服务端的前缀缓存从第一条被截断的结果起就再也命不中 ——
 * 实测该处命中率从 ~95% 掉到 14%，且同一份全文按运行轮数被反复落盘。
 */
function persistFullOutput(content: string, toolName: string, workspaceRoot: string): string {
    const directory = outputDirectory(workspaceRoot);
    mkdirSync(directory, { recursive: true });

    // 内容相同即路径相同：重复派生因此退化为无副作用的 no-op
    const digest = createHash('sha1').update(content).digest('hex').slice(0, 16);
    const filePath = join(directory, `${toolName}_${digest}.txt`);
    if (!existsSync(filePath)) {
        writeFileSync(filePath, content, 'utf-8');
    }

    return filePath;
}

/** 按工作区区分落盘目录，避免不同项目的临时文件互相干扰 */
function outputDirectory(workspaceRoot: string): string {
    const scope = createHash('sha1').update(workspaceRoot).digest('hex').slice(0, 12);
    return join(tmpdir(), 'coding-agent-tool-output', scope);
}


/** 判据来源：外部配置，或推导默认值 */
export type BudgetSource = 'config' | 'derived';

export interface BudgetJudgement {
    value: number;
    source: BudgetSource;
    /** 该取值从何而来 —— 推导默认值必须能读出依据 */
    rationale: string;
}

export interface ContextBudgetJudgement {
    /** 上下文大小的 token 阈值 */
    contextTokens: BudgetJudgement;
    /** 单次工具输出的体量上限 */
    toolOutput: {
        maxChars: number;
        maxLines: number;
        source: BudgetSource;
        rationale: string;
    };
}

/**
 * 未配置 contextTokenBudget 时的推导默认。
 *
 * DeepSeek 文档对 `deepseek-flash` 标注 CONTEXT LENGTH: 1M，但「窗口装得下」
 * 不等于「模型用得好」，且长上下文会成倍放大输入成本。先取约 1/8 作为保守
 * 工作预算；这是个可调整项，等拿到真实任务的上下文增长分布后再校准。
 */
export const DERIVED_CONTEXT_TOKEN_BUDGET = 128_000;

/**
 * 解析最终生效的预算判据：外部配置优先，未配置时使用推导默认值。
 *
 * 本 change 只产出判据，不据此改变运行行为（见 design.md D7）。
 */
export function resolveContextBudget(config: {
    outputBudget?: OutputBudget;
    contextTokenBudget?: number;
}): ContextBudgetJudgement {
    const configuredTokens = config.contextTokenBudget;
    const configuredOutput = config.outputBudget;

    const contextTokens: BudgetJudgement = (configuredTokens !== undefined && configuredTokens > 0)
        ? {
            value: configuredTokens,
            source: 'config',
            rationale: '来自 AgentRuntimeConfig.contextTokenBudget',
        }
        : {
            value: DERIVED_CONTEXT_TOKEN_BUDGET,
            source: 'derived',
            rationale:
                '未配置 contextTokenBudget，使用推导默认值：模型窗口标注为 1M，' +
                '但长上下文存在效果衰减与成本放大，先取约 1/8 作为保守工作预算。',
        };

    const hasOutputConfig = configuredOutput?.maxChars !== undefined
        || configuredOutput?.maxLines !== undefined;

    const toolOutput = hasOutputConfig
        ? {
            maxChars: configuredOutput?.maxChars ?? DEFAULT_OUTPUT_BUDGET.maxChars,
            maxLines: configuredOutput?.maxLines ?? DEFAULT_OUTPUT_BUDGET.maxLines,
            source: 'config' as const,
            rationale: '来自 AgentRuntimeConfig.outputBudget',
        }
        : {
            maxChars: DEFAULT_OUTPUT_BUDGET.maxChars,
            maxLines: DEFAULT_OUTPUT_BUDGET.maxLines,
            source: 'derived' as const,
            rationale:
                '未提供 outputBudget，使用推导默认值：字符上限沿用 read_file 既有量级' +
                '以避免引入新的数量级；行数上限用于覆盖「大量短行」类输出。',
        };

    return { contextTokens, toolOutput };
}
