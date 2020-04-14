/**
 * 对iam名称进行处理
 */

module.exports = function iamNameSanitize(str) {
    return str && str.replace(/[^a-zA-Z0-9-_]/g, '_')
}