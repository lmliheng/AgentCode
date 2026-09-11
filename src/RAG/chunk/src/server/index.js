import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { MilvusClient } from "@zilliz/milvus2-sdk-node";
import { markdown_chunk } from '../chunk/markdown/index.js';
import { createEmbeddings } from '../embedding/embedding.js';
export function createServer(config) {
    // secret 从环境变量读取，config 中的值作为 fallback
    const secret = process.env.SECRET_KEY || config.secret;
    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 5 * 1024 * 1024 } // 限制 5MB
    });
    // 允许的 MIME 类型白名单
    const ALLOWED_MIME_TYPES = new Set([
        'text/plain',
        'text/markdown',
        'text/x-markdown'
    ]);
    /**
     *  @内存存储milvus客户端对象
     */
    let Milvus_client = undefined;
    const app = express();
    app.use(express.json());
    app.use(cors({
        origin: (origin, callback) => {
            // 允许无 origin 的请求（如 curl、postman）
            if (!origin || config.allowedOrigins.includes(origin)) {
                callback(null, true);
            }
            else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true, // 允许携带 cookie / authorization header
        maxAge: 86400, // 预检请求缓存 24h
    }));
    /**
     * @服务检查
     */
    app.get('/', (req, res) => {
        res.json({
            code: 200,
            message: '服务运行'
        });
    });
    /**
     *  @检查milvus运行
     */
    app.get('/getState', async (req, res) => {
        try {
            if (Milvus_client) {
                const result = await Milvus_client.checkHealth();
                return res.json({
                    status: 'ok',
                    milvus: result,
                });
            }
            const address = process.env.MILVUS_DB_IP;
            if (!address) {
                return res.status(500).json({
                    code: 'MILVUS_CONFIG_MISSING',
                    message: '没有配置 MILVUS_DB_IP',
                });
            }
            Milvus_client = new MilvusClient({
                address,
                timeout: 10000,
            });
            const result = await Milvus_client.checkHealth();
            res.json({
                status: 'ok',
                milvus: result,
            });
        }
        catch (err) {
            res.status(500).json({
                status: 'error',
                message: err.message || 'Milvus 连接失败',
            });
        }
    });
    /**
     ◦ @执行前应该/getState再进行collection检查

     */
    app.get('/collection_list', async (req, res) => {
        try {
            if (Milvus_client === undefined) {
                res.json({
                    code: 500,
                    milvus: 'milvus还没连接'
                });
                return;
            }
            let collectionlist = await Milvus_client.listCollections();
            res.json({
                code: 200,
                collections: collectionlist
            });
        }
        catch (e) {
            res.json({
                code: 500,
                message: `服务异常:${e}`
            });
        }
    });
    /**
     * @写入数据到collection
     * TODO: 尚未实现
     */
    app.post('/collection', (req, res) => {
        res.status(501).json({
            code: 501,
            message: '该接口尚未实现'
        });
    });
    /**
     * @
     * 测试功能
     * markdown文件内容文本分块的接口
     * 返回分块后json
     * curl.exe -X POST http://localhost:3000/md_chunk -F "file=@./RAG.md"
     */
    app.post('/md_chunk', upload.single('file'), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: '没有收到文件' });
            }
            // MIME 类型校验
            if (!ALLOWED_MIME_TYPES.has(req.file.mimetype)) {
                return res.status(400).json({
                    error: `不支持的文件类型: ${req.file.mimetype}，仅支持 txt 和 md 文件`
                });
            }
            const { originalname, buffer } = req.file;
            const content = buffer.toString('utf-8');
            // 支持从请求体传入自定义分块参数
            const chunkMaxLength = typeof req.body.chunkMaxLength === 'number'
                ? req.body.chunkMaxLength
                : 120;
            const chunkOverlapLength = typeof req.body.chunkOverlapLength === 'number'
                ? req.body.chunkOverlapLength
                : 40;
            res.json({
                code: 200,
                chunks: markdown_chunk(originalname, content, {
                    chunkMaxLength,
                    chunkOverlapLength
                })
            });
        }
        catch (e) {
            console.error(e);
            res.status(500).json({
                code: 500,
                message: `分块处理异常: ${e instanceof Error ? e.message : e}`
            });
        }
    });
    /**
     * @
     * 测试功能
     * 这段json可以直接上传至milvus
     *  curl.exe -X POST http://localhost:3000/entity -F "file=@./RAG.md"
     */
    app.post('/entity', upload.single('file'), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: '没有收到文件' });
            }
            // MIME 类型校验
            if (!ALLOWED_MIME_TYPES.has(req.file.mimetype)) {
                return res.status(400).json({
                    error: `不支持的文件类型: ${req.file.mimetype}，仅支持 txt 和 md 文件`
                });
            }
            const { originalname, buffer } = req.file;
            const content = buffer.toString('utf-8');
            let chunks = markdown_chunk(originalname, content);
            for (let i = 0; i < chunks.length; i += 64) {
                const batch = chunks.slice(i, i + 64);
                const input = batch.map(chunk => chunk.content);
                const embeddings = await createEmbeddings(input, 256);
                for (let j = 0; j < batch.length; j++) {
                    batch[j].embedding = embeddings[j];
                }
            }
            res.json({
                code: 200,
                chunks: chunks
            });
        }
        catch (e) {
            console.error(e);
            res.status(500).json({
                code: 500,
                message: `处理异常: ${e instanceof Error ? e.message : e}`
            });
        }
    });
    /**
     * @milvus检索
     *
     */
    app.get('/search', async (req, res) => {
        const search_content = typeof req.query.search_content === 'string'
            ? req.query.search_content
            : '';
        if (Milvus_client == undefined) {
            res.json({
                code: 500,
                message: 'milvus未连接'
            });
            return;
        }
        try {
            let rank = await searchQuestion(Milvus_client, search_content, '');
            res.json({
                code: 200,
                rank
            });
        }
        catch (e) {
            res.json({
                code: 500,
                message: '服务异常'
            });
        }
    });
    /**
     * 根据用户问题执行向量检索。
     *
     * 核心流程：
     * 1. 先把用户问题转换成 queryVector；
     * 2. 在 Milvus 里用 queryVector 搜索最相似的 Chunk；
     * 3. 可选使用 Metadata Filter 缩小检索范围；
     * 4. 返回 TopK 结果。
     */
    async function searchQuestion(client, question, filter) {
        const [queryVector] = await createEmbeddings([question], 256);
        const result = await client.search({
            collection_name: process.env.MILVUS_DB_COLLECTION || 'default',
            // 指定在哪个向量字段上做 ANN Search。
            anns_field: 'embedding',
            // 查询向量。这里传数组，是因为 Milvus 支持一次查多个向量。
            data: [queryVector],
            // 返回最相似的前 3 条。
            limit: 3,
            // Metadata Filter，例如：category == "refund"。
            filter,
            // 指定检索结果里需要返回哪些字段。
            output_fields: [
                'chunk_id',
                'content',
                'source',
                'title',
                'category',
                'owner',
                'source_version',
                'chunk_index',
                'content_hash'
            ]
        });
        return result.results;
    }
    return app;
}
