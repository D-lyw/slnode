/**
 * 生成一个临时文件路径
 */

const os = require('os')
const uuid = require('uuid')
const path = require('path')
const fsUtil = require('../util/fs-utils')

module.exports = function tmppath(ext, generator) {
    let result
    generator = generator || uuid.v4
    ext = ext || ''
    while (!result || fsUtil.fileExists(result)) {
        result = path.join(os.tmpdir(), generator() + ext)
    }
    return result
}