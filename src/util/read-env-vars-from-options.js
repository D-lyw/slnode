/**
 * 从传入的options中读取变量值
 */

const fs = require('fs')
const parseKeyValueCSV = require('./parse-key-value-csv')

// 计算元素个数
const countElements = function (object, keys) {
    if (!object || !keys) {
        return 0
    }
    return keys.filter(key => object[key]).length
}

module.exports = function readEnvVarsFromOptions(options) {
    let envVars, fileContents
    if (!options) {
        return undefined
    }
    const optionCount = countElements(options, ['set-env', 'set-env-from-json', 'update-env', 'update-env-from-json'])
    if (optionCount > 1) {
        throw new Error(`--set-env, --set-env-from-json, --update-env, --update-env-from-json 环境参数不能同时使用`)
    }
    ['update', 'set'].forEach(method => {
        if (options[method + '-env']) {
            try {
                envVars = parseKeyValueCSV(options[method + 'env'])
            } catch (e) {
                throw `无法从 ${method}-env 读取变量， ${e}`
            }
        }
        if (options[method + '-env-from-json']) {
            fileContents = fs.readFileSync(options[method + '-env-from-json'], 'utf8')
            try {
                envVars = JSON.parse(fileContents)
            } catch (e) {
                throw `${options[method + '-env-from-json']} 不是一个合法JSON文件`
            }
        }
    })
    return envVars
}