import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { MilvusClient } from "@zilliz/milvus2-sdk-node";
import { markdown_chunk } from '../chunk/markdown/index.js';
import { createEmbeddings } from '../embedding/embedding.js';
export function createServer(config) {
    const upload = multer({ storage: multer.memoryStorage() });
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
     */
    app.post('/collection', (req, res) => {
    });
    /**
     * @
     * 测试功能markdown文件内容文本分块的接口
     * 返回分块后json
     * curl.exe -X POST http://localhost:3000/md_chunk -F "file=@./RAG.md"
     */
    app.post('/md_chunk', upload.single('file'), async (req, res) => {
        // res.file?.originalname /size/mimetype
        try {
            if (!req.file) {
                return res.status(400).json({ error: '没有收到文件' });
            }
            const { originalname, buffer, mimetype, size } = req.file;
            const content = buffer.toString('utf-8');
            res.json({
                code: 200,
                chunks: markdown_chunk(originalname, content)
            });
        }
        catch (e) {
            console.log(e);
        }
    });
    app.post('/entity', upload.single('file'), async (req, res) => {
        // res.file?.originalname /size/mimetype
        try {
            if (!req.file) {
                return res.status(400).json({ error: '没有收到文件' });
            }
            const { originalname, buffer, mimetype, size } = req.file;
            const content = buffer.toString('utf-8');
            let chunks = markdown_chunk(originalname, content);
            console.log('---完成分块:', chunks);
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
            console.log(e);
        }
    });
    return app;
}
