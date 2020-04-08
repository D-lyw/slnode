module.exports = function ConsoleLogger(prefix, loggable) {
    let currentStage = ''
    let currentPrepend = ''
    const writer = loggable || console
    const prepend = prefix || '\x1b[1F\x1b[2K'
    
    const formatArgs = function (argArr) {
        if (!Array.isArray(argArr) || !argArr.length) {
            return ''
        }
        const arg0 = argArr[0]
        return Object.keys(arg0)
            .filter(useKey => /Name$/i.test(useKey) || /Id$/i.test(useKey) || /^path/i.test(useKey))
            .sort()
            .map(key => `\t${key}=${arg0[key]}`)
            .join('')
    }
    this.logStage = function (stage) {
        currentStage = stage + '\t'
        writer.error(currentStage + stage)
        currentPrepend = prepend
    }
    this.logApiCall = function (serviceCall, arg) {
        writer.error(currentPrepend + currentStage + serviceCall + formatArgs(arg))
        currentPrepend = prepend
    }
}