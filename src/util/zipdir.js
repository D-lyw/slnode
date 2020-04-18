/**
 * 压缩打包目录
 */

const fsUtil = require('../util/fs-utils')
const fs = require('fs')
const archiver = require('archiver')
const tmppath = require('../util/tmppath')

module.exports = function zipdir (path) {
    const targetFile = tmppath('.zip')   
    // 校验传入路径参数
    if (!fsUtil.fileExists(path)) {
        return Promise.reject(path + '不存在')
    } else if (!fsUtil.isDir(path)) {
        return Promise.reject(path + '不是一个目录')
    }

    return new Promise((resolve, reject) => {
        const archive = archiver.create('zip', {})
        const zipStream = fs.createWriteStream(targetFile)

        zipStream.on('close', () => {
            fsUtil.rmDir(path)
            resolve(targetFile)
        })
        archive.pipe(zipStream)
        archive.directory(path, '')
        archive.on('error', e => reject(e))
        archive.finalize()
    })
}