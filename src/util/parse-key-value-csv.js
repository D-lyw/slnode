/**
 * 从CSV格式中解析变量名和值
 */

module.exports = function parseKeyValueCSV(string) {
    const result = {}
    if (!string || !string.trim().length) {
        throw '不合法的CSV'
    }
    string.trim().split(',').forEach(pair => {
        const keyval = pair && pair.split('=');
        if (!keyval || keyval.length < 2) {
            throw `不合法的CSV元素 ${pair}`
        }
        result[keyval[0]] = keyval.slice(1).join('=')
    })
    
    return result
}