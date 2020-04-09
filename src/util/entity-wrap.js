
const aws = require('aws-sdk')


const listWrappableFunctions = function (object) {
    const excluded = ['constructor']
    const excludedPrototypes = [Array.prototype, Object.prototype, Function.prototype, aws.Service.prototype]
    
    const isFunction = function (key) {
        return typeof object[key] === 'function'
    }
    const notExcluded = function (key) {
        return excluded.indexOf(key) < 0
    }
    const ownFunctions = function (target) {
        return Object.keys(target)
            .filter(target.hasOwnProperty.bind(target))
            .filter(isFunction)
            .filter(notExcluded)
    }
    const hierarchicalFunctions = function (target) {
        const result = ownFunctions(target)
        const proto = Object.getPrototypeOf(target)
        if (excludedPrototypes.indexOf(proto) < 0) {
            return result.concat(hierarchicalFunctions(proto))
        } else {
            return result
        }
    }
    return hierarchicalFunctions(object)
}



module.exports = function entityWrap (apiObject, options) {
    const logPrefix = (options && options.logName && (options.logName + '.')) || ''
    const magic = '__LOGGING_WRAP__'
    const remapKey = function (key) {
        let oldFunc
        if (!apiObject[key][magic]) {
            oldFunc = apiObject[key]
            apiObject[key] = function () {
                const callArgs = arguments
                options.log(logPrefix + key, Array.prototype.slice.call(callArgs))
                return oldFunc.apply(apiObject, callArgs)
            }
            apiObject[key][magic] = magic
        }
    }
    if (!options || !options.log) {
        return apiObject
    }
    listWrappableFunctions(apiObject).forEach(remapKey)

    return apiObject
}