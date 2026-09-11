import { embeddingZ } from "./embeddingZ.js";
import { writeFile } from 'fs/promises'
import path from "path";
let res = await embeddingZ('说说milvus', 256)
writeFile(path.join(import.meta.dirname, '1.txt'), JSON.stringify(res), 'utf-8')