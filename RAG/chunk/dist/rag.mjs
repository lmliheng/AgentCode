import path$1 from 'path';
import { readFile, appendFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';
import { readFile as readFile$1, appendFile as appendFile$1, writeFile as writeFile$1 } from 'fs/promises';

/**
 * 
 * @param {*} source_path md文件的绝对路径
 * @param {*} target_path json文件的绝对路径
 * @param {*}  options = {
 *                  chunkMaxLength: 120,
 *                  chunkOverlapLength: 40// overlap 可以减少上下文被切断的问题。
 *                  }
 */
async function markdown_chunk(
    source_path,
    target_path,
    options = {
        chunkMaxLength: 120,
        chunkOverlapLength: 40// overlap 可以减少上下文被切断的问题。
    }
) {
    //先检查targat_path的json文件是否合法
    if (!(isWindowsPath(source_path) && isWindowsPath(target_path))) {
        throw new Error("文件路径不合法")
    }
    try {
        let document = await readFile(source_path, 'utf8');
        let parse = parseMarkdown({
            fileName: path.basename(source_path),
            rawText: document,
        });
        let chunk = createChunks(parse, options);
        await appendFile(target_path, '');
        let chunks = await readFile(target_path, 'utf8');
        if (chunks == '') {
            chunks = '[]';
        }
        let chunks_json = JSON.parse(chunks);
        chunks_json.push(...chunk);
        await writeFile(target_path, JSON.stringify(chunks_json, null, 2));

    } catch (e) {
        console.log(e);
    }

}


/**
 * 计算文本的 sha256 哈希值。
 *
 * 这里主要用于生成 contentHash，
 * 方便判断 Chunk 内容是否发生变化。
 */
function sha256(text) {
    return createHash('sha256').update(text).digest('hex')
}

/**
 * 对原始文本做基础清洗。
 *
 * 主要处理：
 * 1. 统一换行符
 * 2. 替换 tab
 * 3. 合并多余空格
 * 4. 合并过多空行
 * 5. 去掉首尾空白
 */
function normalizeText(text) {
    return text
        .replace(/\r\n/g, '\n')
        .replace(/\t/g, ' ')
        .replace(/[ ]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

/**
 * 从 Markdown 文档里读取简单的元信息。
 *
 * 例如：
 * category: after-sales
 * owner: customer-service
 * version: v1
 *
 * 如果没有读取到，就使用 fallback 默认值。
 */
function readMetaLine(lines, name, fallback) {
    const line = lines.find((item) => item.startsWith(`${name}:`));

    if (!line) {
        return fallback
    }
    return line.replace(`${name}:`, '').trim()
}

/**
 * 解析 Markdown 文档。
 *
 * 这一步会从原始 Markdown 中提取：
 * - 文件名
 * - 标题
 * - category
 * - owner
 * - version
 * - 正文内容
 */
function parseMarkdown({ fileName, rawText }) {
    const normalizedText = normalizeText(rawText);
    const lines = normalizedText.split('\n');

    // 默认把一级标题作为文档标题。
    // 如果文档里没有一级标题，就使用文件名作为标题。
    const titleLine = lines.find((line) => line.startsWith('# '));
    const title = titleLine?.replace(/^#\s+/, '').trim() ?? fileName;

    // 从文档中读取 Metadata。
    const category = readMetaLine(lines, 'category', 'unknown');
    const owner = readMetaLine(lines, 'owner', 'unknown');
    const sourceVersion = readMetaLine(lines, 'version', 'v1');

    // 正文中不再保留 category / owner / version 这些元信息行。
    // 这些信息会被放到 metadata 字段里。
    const body = lines
        .filter((line) => !line.startsWith('category:'))
        .filter((line) => !line.startsWith('owner:'))
        .filter((line) => !line.startsWith('version:'))
        .join('\n');

    return {
        fileName,
        title,
        category,
        owner,
        sourceVersion,
        text: normalizeText(body)
    }
}

/**
 * 处理超长段落。
 *
 * 如果某个段落本身已经超过 chunkMaxLength，
 * 就只能按照固定长度继续切成多个小片段。
 */
function splitLongParagraph(paragraph, options) {
    const parts = [];

    for (let start = 0; start < paragraph.length; start += options.chunkMaxLength) {
        parts.push(paragraph.slice(start, start + options.chunkMaxLength).trim());
    }

    return parts.filter(Boolean)
}

/**
 * 把文档正文拆成段落数组。
 *
 * 规则：
 * - 先按空行拆分段落
 * - 段落内部的换行替换成空格
 * - 过滤空段落
 * - 如果段落太长，再继续切小
 */
function splitIntoParagraphs(text, options) {
    return text
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.replace(/\n/g, ' ').trim())
        .filter(Boolean)
        .flatMap((paragraph) => {
            if (paragraph.length <= options.chunkMaxLength) {
                return [paragraph]
            }

            return splitLongParagraph(paragraph, options)
        })
}

/**
 * 从当前 Chunk 末尾取一段文本作为 overlap。
 *
 * overlap 的作用是：
 * 让相邻 Chunk 之间保留一点重复内容，
 * 避免重要语义刚好被切断。
 */
function takeOverlap(text,options) {
    if (options.chunkOverlapLength <= 0) {
        return ''
    }
    return text.slice(-options.chunkOverlapLength).trim()
}

/**
 * 生成稳定的 Chunk ID。
 *
 * Chunk ID 中包含：
 * - 来源文件名
 * - 来源版本
 * - Chunk 序号
 * - 内容哈希
 *
 * 这样做的好处是：
 * 当文档内容或版本变化时，可以更容易识别哪些 Chunk 发生了变化。
 */
function toChunkId({ fileName, sourceVersion, chunkIndex, content }) {
    const sourceName = fileName.replace(/\.md$/, '');
    const contentHash = sha256(content).slice(0, 12);
    const indexText = String(chunkIndex).padStart(3, '0');

    return `${sourceName}:${sourceVersion}:${indexText}:${contentHash}`
}

/**
 * 把一份文档切成多个 Chunk。
 *
 * 整体流程：
 * 1. 先把正文拆成段落
 * 2. 尽量把多个段落合并成一个 Chunk
 * 3. 如果超过最大长度，就结束当前 Chunk
 * 4. 新 Chunk 开头带上一点 overlap
 * 5. 最后为每个 Chunk 补充 metadata
 */
function createChunks(document, options) {
    const paragraphs = splitIntoParagraphs(document.text, options);
    const chunks = [];
    let current = [];
    for (const paragraph of paragraphs) {
        // 尝试把当前段落加入正在构建的 Chunk。
        const nextText = [...current, paragraph].join('\n\n');

        // 如果加入后超过最大长度，就先保存当前 Chunk。
        if (current.length > 0 && nextText.length > options.chunkMaxLength) {
            const content = current.join('\n\n');
            chunks.push(content);

            // 从上一个 Chunk 的末尾取一小段作为下一个 Chunk 的开头。
            const overlap = takeOverlap(content,options);
            current = overlap ? [overlap, paragraph] : [paragraph];
            continue
        }

        current.push(paragraph);
    }

    // 循环结束后，如果还有未保存的内容，需要补上最后一个 Chunk。
    if (current.length > 0) {
        chunks.push(current.join('\n\n'));
    }

    // 把普通字符串 Chunk 转成结构化数据。
    return chunks.map((content, index) => {
        const chunkIndex = index + 1;
        const contentHash = sha256(content).slice(0, 12);

        return {
            chunkId: toChunkId({
                fileName: document.fileName,
                sourceVersion: document.sourceVersion,
                chunkIndex,
                content
            }),

            // Chunk 的正文内容。
            // 后续会对这个 content 做 Embedding。
            content,

            // Chunk 的元信息。
            // 后续检索、过滤、展示来源、版本更新都会用到这些信息。
            metadata: {
                source: document.fileName,
                title: document.title,
                category: document.category,
                owner: document.owner,
                sourceVersion: document.sourceVersion,
                chunkIndex,
                contentHash,
                chunkLength: content.length
            }
        }
    })
}


/**
 * @合法的windows绝对路径
 */
function isWindowsPath(path) {
    return /^[A-Za-z]:\\.+$/.test(path);
}

/**
 * @解析PDF
 * 调用：pdf-parse
 * 
 * @param {*} source_path 
 * @param {*} target_path 
 * @param {*} options 
 */
async function pdf_chunk(
    source_path,
    target_path,
    options = {
        chunkMaxLength: 120,
        chunkOverlapLength: 40// overlap 可以减少上下文被切断的问题。
    }
) {

    try {
        let buffer = await readFile$1(source_path);
        let parser = new PDFParse({ data: buffer });
        let PDF_text = await parser.getText();
        let PDF_meta = await parser.getInfo({ parsePageInfo: true });
        await parser.destroy();
        let parseText = parseMarkdown({
            fileName: path$1.basename(source_path),
            rawText: PDF_text.text
        });
        let chunk = createChunks(parseText, options);
        await appendFile$1(target_path, '');
        await writeFile$1(target_path, JSON.stringify(chunk, null, 2));
    } catch (e) {
        console.log(e);
    }

}

/**
 * @资料读取解析分块存储
 * 
 */
var index = {
    markdown_chunk,
    pdf_chunk,

};

if (process.argv[2] === '--md') {
    await markdown_chunk(
        path$1.join(import.meta.dirname, 'documents/FileSystemMCP-design.md'),
        path$1.join(import.meta.dirname, 'output/8.json'),
        {
            chunkMaxLength: 100,
            chunkOverlapLength: 40
        }
    );
}

if (process.argv[2] === '--pdf') {
    await pdf_chunk(
        path$1.join(import.meta.dirname, 'documents/resume.pdf'),
        path$1.join(import.meta.dirname, 'output/4.json'),
        {
            chunkMaxLength: 150,
            chunkOverlapLength: 40
        }
    );

}

export { index as default };
