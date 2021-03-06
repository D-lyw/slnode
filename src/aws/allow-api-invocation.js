/**
 * 允许api调用
 */

const aws = require('aws-sdk')

module.exports = function allowApiInvocation(functionName, functionVersion, restApiId, ownerId, awsPartition, awsRegion, path) {

    const lambda = new aws.Lambda({region: awsRegion})
    const activePath = path || '*/*/*'
    const policy = {
        Action: 'lambda:InvokeFunction',
        FunctionName: functionName,
        Principal: 'apigateway.amazonaws.com',
        SourceArn: 'arn:' + awsPartition + ':execute-api:' + awsRegion + ':' + ownerId + ':' + restApiId + '/' + activePath,
        Qualifier: functionVersion,
        StatementId: 'web-api-access-' + functionVersion + '-' + Date.now()
    }

    const matchesPolicy = function (statement) {
        return statement.Action === policy.Action &&
            statement.Principal && statement.Principal.Service === policy.Principal &&
            statement.Condition && statement.Condition.ArnLike &&
            statement.Condition.ArnLike['AWS:SourceArn'] === policy.SourceArn &&
            statement.Effect === 'Allow'
    }

    return lambda.getPolicy({
        FunctionName: functionName,
        Qualifier: functionVersion
    }).promise()
    .then(policyResponse => policyResponse && policyResponse.Policy && JSON.parse(policyResponse.Policy))
    .then(currentPolicy => {
        const statements = (currentPolicy && currentPolicy.Statement) || []
        if (!statements.find(matchesPolicy)) {
            return lambda.addPermission(policy).promise()
        }
    }, e => {
        if (e && e.code === 'ResourceNotFoundException') {
            return lambda.addPermission(policy).promise()
        } else {
            return Promise.reject(e)
        }
    })
}