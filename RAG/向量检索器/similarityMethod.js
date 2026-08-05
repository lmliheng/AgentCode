/**
 * @向量相似度计算
 */


/**
 * @余弦相似度
 */
export function cosSimlarity(v1, v2) {
    if (v1.length !== v2.length) {
        throw new Error('向量长度不一样')
    }
    let dotProduct = 0
    let firstLength = 0
    let secondLength = 0

    for (let i = 0; i < v1.length; i++) {
        dotProduct += v1[i] * v2[i]
        firstLength += v1[i] ** 2
        secondLength += v2[i] ** 2
    }

    if (firstLength === 0 && secondLength === 0) {
        throw new Error('不能计算零向量的余弦相似度')
    }
    return dotProduct / ((Math.sqrt(firstLength) * Math.sqrt(secondLength)))
}