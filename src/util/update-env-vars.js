/**
 * 更新环境变量
 */

const readEnvVarsFromOptions = require('../util/read-env-vars-from-options')
const mergeProperties = require('../util/merge-properties')

module.exports = function updateEnvVars (options, lambdaAPI, functionName, existingVars) {
    const kmsKey = options['env-kms-key-arn']
    const envVars = readEnvVarsFromOptions(options)
    const configUpdate = {}
    
    let shouldUpdate = false
    if (envVars) {
        shouldUpdate = true
        configUpdate.Environment = { Variables: {}}
        if ((options['update-env'] || options['update-env-from-json']) && existingVars) {
            mergeProperties(configUpdate.Environment.Variables, existingVars)
        }
        mergeProperties(configUpdate.Environment.Variables, envVars)
    }
    if (kmsKey || kmsKey === '') {
        shouldUpdate = true
        configUpdate.KMSKeyArn = kmsKey
    }
    if (!shouldUpdate) {
        return Promise.resolve()
    }
    configUpdate.FunctionName = functionName
    return lambdaAPI.updateFunctionConfiguration(configUpdate).promise()
}