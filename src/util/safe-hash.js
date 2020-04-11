/**
 * 返回一个对象的哈希值
 */

const crypto = require('crypto')

module.exports = function safeHash (object) {
    const hash = crypto.createHash('sha256')
    if (typeof object === 'string') {
        hash.update(object, 'utf8')
    } else {
        hash.update(JSON.stringify(object), 'utf8')
    }

    return hash.digest('base64').replace(/\+/g, '-')
}