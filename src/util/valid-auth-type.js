/**
 * 校验是否是支持的类型
 */

module.exports = function validAuthType(type) {
    const authTypes = ['AWS_IAM', 'NONE', 'CUSTOM']
    return (authTypes.indexOf(type) >= 0)
}