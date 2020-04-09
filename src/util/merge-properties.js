/**
 * 合并属性
 */

module.exports = function mergeProperties(mergeTo, mergeFrom) {
    Object.keys(mergeFrom)
        .forEach(k => mergeTo[k] = mergeFrom[k])
}