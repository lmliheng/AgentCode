import { client } from "./connect.js";

/**
 * 
 * 
 * 多租户策略，数据隔离
 * @数据库创建
 * 
 * 使用的是 Zilliz Cloud Serverless 免费版，只支持一个默认数据库
 */
// await client.createDatabase({
//     db_name: 'yuque_db',
//     properties: {
//         "database.replica.number": 3
//     }
// })

/**
 * @查看数据库或者数据库列表
 */
// await client.describeDatabase({
//     db_name:'yuque_db'
// })
let res=await client.listDatabases()
console.log(res)


