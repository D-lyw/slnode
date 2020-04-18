

module.exports = function markAlias (functionName, lambda, versionName, versionAlias) {
    const config = {
        FunctionName: functionName,
        FunctionVersion: versionName,
        Name: versionAlias
    }
    
    return lambda.updateAlias(config).promise()
        .catch(e => {
            if (e && e.code === 'ResourceNotFoundException') {
                return lambda.createAlias(config).promise()
            } else {
                return Promise.reject(e)
            }
        })
}