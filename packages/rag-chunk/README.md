<p align="center">
  <svg viewBox="0 0 48 48" width="64" height="64" xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="6" width="32" height="36" rx="3" fill="#E8F5E9" stroke="#43A047" stroke-width="2"/>
    <line x1="14" y1="14" x2="34" y2="14" stroke="#43A047" stroke-width="2" stroke-linecap="round"/>
    <line x1="14" y1="20" x2="30" y2="20" stroke="#66BB6A" stroke-width="2" stroke-linecap="round"/>
    <line x1="14" y1="26" x2="26" y2="26" stroke="#81C784" stroke-width="2" stroke-linecap="round"/>
    <line x1="14" y1="32" x2="22" y2="32" stroke="#A5D6A7" stroke-width="2" stroke-linecap="round"/>
    <circle cx="36" cy="12" r="6" fill="#FFC107" stroke="#FF8F00" stroke-width="1.5"/>
    <text x="36" y="14" text-anchor="middle" font-size="7" fill="#FFF" font-weight="bold">AI</text>
  </svg>
</p>

<h1 align="center">@lmliheng/rag-chunk</h1>

<p align="center">
  <svg viewBox="0 0 20 20" width="16" height="16" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="8" fill="#4CAF50"/></svg>
  <b>Document Parsing</b>
  &nbsp;&nbsp;
  <svg viewBox="0 0 20 20" width="16" height="16" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="8" fill="#2196F3"/></svg>
  <b>Text Chunking</b>
  &nbsp;&nbsp;
  <svg viewBox="0 0 20 20" width="16" height="16" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="8" fill="#FF9800"/></svg>
  <b>Vector Embedding</b>
  &nbsp;&nbsp;
  <svg viewBox="0 0 20 20" width="16" height="16" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="8" fill="#9C27B0"/></svg>
  <b>Milvus Search</b>
</p>

<p align="center">
  RAG 资料处理流水线 &mdash; 从文档解析到向量检索的一站式工具包
</p>

---

## 架构

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Markdown │───▶│          │    │          │    │          │
│    PDF    │───▶│  Chunk   │───▶│Embedding │───▶│  Milvus  │
│   DOCX*   │───▶│  Split   │    │(ZhipuAI) │    │  Search  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                        │                            │
                        ▼                            ▼
                   JSON Output               REST API
```

## 功能

<svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle"><path fill="#4CAF50" d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg> **文档解析** — Markdown 元数据提取、PDF 文本抽取

<svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle"><path fill="#2196F3" d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg> **智能分块** — 段落感知、可配置 overlap、长度自适应

<svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle"><path fill="#FF9800" d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg> **向量化** — 对接智谱 embedding-3 模型，支持 128/256/512 维度

<svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle"><path fill="#9C27B0" d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg> **向量检索** — 连接 Milvus/Zilliz Cloud，支持 ANN 搜索与标量过滤

<svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle"><path fill="#607D8B" d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg> **REST API** — Express 服务，提供分块/嵌入/检索接口

## 技术栈

| 模块 | 技术 |
|------|------|
| 运行时 | Node.js 24+, TypeScript 5.x |
| Web 框架 | Express 5 |
| 向量数据库 | @zilliz/milvus2-sdk-node |
| Embedding | 智谱 AI embedding-3 |
| 文档解析 | pdf-parse |
| 文件上传 | multer |

## 项目结构

```
├── index.ts                 # 入口 & CLI
├── src/
│   ├── server/index.ts      # Express Web 服务
│   ├── chunk/
│   │   ├── markdown/index.ts  # Markdown 解析 & 分块引擎
│   │   ├── pdf/index.ts       # PDF 解析
│   │   └── word/index.ts      # (开发中)
│   ├── embedding/embedding.ts # 向量化
│   └── file/write.ts          # (开发中)
├── documents/               # 示例文档
├── output/                  # 分块输出
└── .env                     # API Key & Milvus 配置
```

## 环境变量

<svg viewBox="0 0 16 16" width="14" height="14" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle"><circle cx="8" cy="8" r="7" fill="#E53935"/></svg> `Z_API_KEY` — 智谱 AI API Key

<svg viewBox="0 0 16 16" width="14" height="14" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle"><circle cx="8" cy="8" r="7" fill="#1E88E5"/></svg> `MILVUS_DB_IP` — Milvus 地址

<svg viewBox="0 0 16 16" width="14" height="14" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle"><circle cx="8" cy="8" r="7" fill="#1E88E5"/></svg> `MILVUS_DB_COLLECTION` — Collection 名称

## API 路由

```
GET  /              健康检查
GET  /getState      检查 Milvus 连接状态
GET  /collection_list  列出 Milvus Collections
POST /md_chunk      上传 Markdown → 返回分块 JSON
POST /entity        上传 Markdown → 分块 + 嵌入 → 返回完整 JSON
GET  /search?search_content=关键词  向量检索
```