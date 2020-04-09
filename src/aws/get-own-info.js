/**
 * 获取所有者的基本信息
 */

const aws = require('aws-sdk')
const NullLogger = require('../util/null-logger')
const entityWrap = require('../util/entity-wrap')

module.exports = function getOwnerInfo(region, optionalLogger) {
    const logger = optionalLogger || new NullLogger()
    const sts = entityWrap(new aws.STS({region: region}), {log: logger.logApiCall, logName: 'sts'})

    return sts.getCallerIdentity().promise()
        .then(callerIdentity => ({
            account: callerIdentity.Account,
            partition: callerIdentity.Arn.split(':')[1]
        }))
}






