/**
 * 根据传入的options值，初始化对应的环境变量
 */

const readEnvVarsFromOptions = require('./read-env-vars-from-options')
const mergeProperties = require('./merge-properties')

module.exports = function initEnvVarsFromOptions(options) {
    return new Promise(resolve => {
        const result = readEnvVarsFromOptions(options)
        if (result) {
            mergeProperties(process.env, result)
        }
        resolve(result && {Variables: result})
    })
}