# spike —— 一次性探针脚本

这里放的是 RAG 各阶段的验证脚本（解析、分块、检索、存储选型）。**不是产品代码**：
它们只求把一个问题问清楚，跑完就留在原地当证据，不追求可维护。

## 跑之前：数据在哪

这些脚本写在仓库拆分之前，路径曾经写死成作者机器上的 `C:/Users/Lenovo/...`，
换台机器就全跑不了。现在统一从 `spike/paths.ts` 取，默认值按当前仓库布局推导：

| 变量 | 含义 | 默认值 |
|---|---|---|
| `ACODE_MYRAG_ROOT` | 拆分前 `src/RAG` 那一层（其下有 `Milvus/`、`MyRAG/`） | 仓库根 |
| `ACODE_MYRAG_DATA` | 语料目录（当年是 `src/RAG/Milvus/data`） | `<ROOT>/Milvus/data` |
| `ACODE_MYRAG_DOCS` | 文档目录（docx/pdf/md） | `packages/rag-chunk/documents` |
| `ACODE_MYRAG_SEED` | 评测种子问题集 | `packages/myrag/eval/queries.json` |
| `ACODE_MYRAG_ZVEC` | zvec 库目录 | `<ROOT>/MyRAG/zvec-data/myrag` |

默认路径不存在时脚本会先打印一行提示（含该设哪个变量），不会让你对着
`ENOENT C:\...` 猜。**注意**：`Milvus/data` 那批语料随拆分留在了原仓库，没迁过来，
所以除了走 `packages/rag-chunk/documents` 的那几个探针，其余都得先把语料放回来。

## 命令

见 `package.json` 的 scripts（`probe:*` / `verify:*` / `dump:*` / `review:*`），
需要外部服务的带 `--env-file=../rag-chunk/.env`。
