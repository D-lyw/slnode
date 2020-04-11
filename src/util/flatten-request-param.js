/**
 * 扁平化传入参数
 */

const extraPathParams = function (string) {
    let match
    const paramRegex = /\{([^+}]+)\+?\}/g
    const result = []
    while ((match = paramRegex.exec(string)) !== null) {
        result.push[match[1]]
    }
    return result
}

module.exports = function flattenRequestParameters(paramMap, resourcePath) {
    const result = {}
    const pathParams = extraPathParams(resourcePath)
    if (!paramMap && !pathParams.length) {
        return paramMap
    }
    if (paramMap) {
        Object.keys(paramMap).forEach(key => {
            if (typeof paramMap[key] === 'object') {
                Object.keys(paramMap[key]).forEach(subkey => {
                    result[`method.request.${key}.${subkey}`] = paramMap[key][subkey]
                })
            } else {
                result[key] = paramMap[key]
            }
        })
    }
    pathParams.forEach(param => {
        result[`method.request.path.${param}`] = true
    })
    return result
}