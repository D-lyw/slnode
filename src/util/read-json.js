/**
 * 读取Json文件内容
 */

// 使用fs库中提供的promise方式而不是 fs-promise文件中的内容
const fsPromise = require('fs').promises
const fsUtils = require('./fs-utils')

module.exports = function readJson (fileName) {
    if (!fileName) {
        return Promise.reject('未提供文件名')
    }
    if (!fsUtils.fileExists(fileName)) {
        return Promise.reject(`该文件不存在`)
    }
    return fsPromise.readFile(fileName, {encoding: 'utf8'})
        .then(content => {
            try {
                return JSON.parse(content)
            } catch (e) {
                throw `读取文件 ${fileName} 失败`
            }
        })
}