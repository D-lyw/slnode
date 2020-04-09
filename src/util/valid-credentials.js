/**
 * 校验凭据合法性
 */

module.exports = function validCredential(creds) {
    const credsRegex = /^arn:aws[^:]*:(iam|sts):[^:]*:(\*|\d{12})?:/
    return creds === true || ((typeof creds === 'string') && credsRegex.test(creds))
}