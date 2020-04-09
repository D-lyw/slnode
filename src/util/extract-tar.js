/**
 * 提取解压文件
 */

const fs = require('fs')
const gunzip = require('gunzip-maybe')
const tarStream = require('tar-fs')

module.exports = function extractTar(archive, dir) {
    return new Promise((resolve, reject) => {
        const extractStream = tarStream.extract(dir)
        extractStream.on('finish', () => resolve(dir))
        extractStream.on('error', reject)
        fs.createReadStream(archive).pipe(gunzip()).pipe(extractStream)
    })
}