/**
 * 执行npm 命令
 */

const which = require('which')
const spawnPromise = require('../util/spawn-promise')

let npmPath;

const removeKeysWithPrefix = function (object, prefix) {
    const result = {}
    if (typeof object !== 'object') {
        return object
    }
    Object.keys(object).forEach(key => {
        if (key.indexOf(prefix) !== 0) {
            result[key] = object[key]
        }
    })
    return result
}

const findNpm = function () {
    if (npmPath) {
        return Promise.resolve(npmPath)
    }
    return new Promise((resolve, reject) => {
        which('npm', (err, path) => {
            if (err) {
                return reject(err)
            }
            npmPath = path
            resolve(path)
        })
    })
}

const toArgs = function (opts) {
    if (!opts) {
        return []
    }
    if (Array.isArray(opts)) {
        return opts
    }
    if (typeof opts === 'string') {
        return opts.split(' ')
    }
    throw new Error(`无法转换参数 ${opts}`)
}

module.exports = function runNpm (dir, options, logger, suppressOutput) {
    const env = removeKeysWithPrefix(process.env, 'npm_')
    const args = toArgs(options)
    const commandDesc = 'npm ' + args.join(' ')

    logger.logApiCall(commandDesc)
    return findNpm()
        .then(command => spawnPromise(command, args, {env: env, cwd: dir}, suppressOutput))
        .then(() => dir)
        .catch(() => {
            return Promise.reject(commandDesc + '执行失败')
        })
}