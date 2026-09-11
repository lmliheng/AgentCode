import { client } from "./connect.js";
/**
 * @创建collection
 * 
 */
await client.useDatabase({
    db_name: process.env.MILVUS_DB_NAME
})
let collectionlist = await client.listCollections()
console.table(collectionlist)

let exist=await client.hasCollection({
    
})
