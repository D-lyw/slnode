/**
 * 实现与fs库相关的一些文件操作函数
 */

const fs = require('fs')
const path = require('path')
const fsExtra = require('fs-extra')
const glob = require('glob')

const safeStats = function (filePath) {
    try {
        return fs.statSync(filePath)
    } catch (e) {
        return false
    }
}

const safeLStats = function (filePath) {
    try {
        return fs.lstatSync(filePath)
    } catch (e) {
        return false
    }
}

module.exports.ensureCleanDir = function (dirPath) {
    fsExtra.emptyDirSync(dirPath)
}

exports.silentRemove = exports.rmDir = function (dirPath) {
    fsExtra.removeSync(dirPath)
}

module.exports.fileExists = function (filePath) {
    return fs.existsSync(filePath)
}

module.exports.isDir = function (filePath) {
    const stats = safeStats(filePath)
    return stats && stats.isDirectory()
}

module.exports.isFile = function (filePath) {
    const stats = safeStats(filePath) 
    return stats && stats.isFile()
}

module.exports.isLink = function (filePath) {
    const stats = safeLStats(filePath)
    return stats && stats.isSymbolicLink()
}

module.exports.copy = function (from, to, doNotPrependPath) {
    const stats = safeStats(to)
    const target = doNotPrependPath ? to : path.join(to, path.basename(from))
    if (!stats) {
        throw new Error(`${to} does not exist`)
    }
    if (!stats.isDirectory()) {
        throw new Error(`${to} is not a directory`)
    }
    fsExtra.copySync(from, target, {dereference: true})
}
// 递归遍历文件目录
module.exports.recursiveList = function (filePath) {
    const result = []
    const addDir = function (dirPath, prefix) {
        const entries = fs.readdirSync(dirPath)
        entries.forEach(entry => {
            const realEntryPath = path.join(dirPath, entry)
            const entryStat = safeStats(realEntryPath)
            const logicalPath = prefix ? path.join(prefix, entry) : entry
            result.push(logicalPath)
            if (entryStat.isDirectory()) {
                addDir(realEntryPath, logicalPath)
            }
        })        
    }
    const filePathStats = safeStats(filePath)
    if (!filePathStats) {
        return glob.sync(filePath)
    }

    if (filePathStats.isFile()) {
        return [filePath]
    }
    if (filePathStats.isDirectory()) {
        addDir(filePath)
        return result
    }
}

module.exports.move = function (fromPath, toPath) {
    fsExtra.moveSync(fromPath, toPath, { overwrite: true})
}