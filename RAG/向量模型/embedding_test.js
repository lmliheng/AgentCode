import { embeddingZ } from "../embeddingZ.js";
let res = await embeddingZ('我是liheng', 512)
console.log(res.length)