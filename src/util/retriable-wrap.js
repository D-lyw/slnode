
const retry = require('oh-no-i-insist')

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

module.exports = function retriableWrap(apiObject, onRetry, timeout, retries, suffix) {
    timeout = timeout || 3000
    retries = retries || 10
    suffix = suffix || 'Promise'

    const remapKey = function (key) {
        const oldFunc = apiObject[key]
        apiObject[key + suffix] = function () {
            const callArgs = arguments
            return retry(
                () => {
                    const result = oldFunc.apply(apiObject, callArgs)
                    if (result && result.promise && typeof result.promise === 'function') {
                        return result.promise()
                    } else {
                        return result
                    }
                },
                timeout, 
                retries,
                failure => failure.code && failure.code === 'TooManyRequestsException',
                onRetry,
                Promise
            )
        }
    }

    const rx = new RegExp(suffix + '$')
    const matching = function (key) {
        return !rx.test(key)
    }

    listWrappableFunctions(apiObject).filter(matching).forEach(remapKey)

    return apiObject
}