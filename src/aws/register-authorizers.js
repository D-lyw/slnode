/**
 * 注册授权
 */

const aws = require('aws-sdk')
const entityWrap = require('../util/entity-wrap')
const retriableWrap = require('../util/retriable-wrap')
const allowApiInvocation = require('../aws/allow-api-invocation')
const NullLogger = require('../util/null-logger')
const sequentialPromiseMap = require('sequential-promise-map')

module.exports = function registerAuthorizers(authorizerMap, apiId, ownerAccount, awsPartition, awsRegion, functionVersion, optionalLogger) {
    const logger = optionalLogger || new NullLogger()
    const apiGateWay = retriableWrap(
        entityWrap(
            new aws.APIGateway({region: awsRegion}),
            {log: logger.logApiCall, logName: 'apigateway'}
        ),
        () => logger.logApiCall('AWS 限制了速率，请稍后再重试')
    )
    const lambda = entityWrap(new aws.Lambda({region: awsRegion}), {log: logger.logApiCall, logName: 'lambda'})

    const removeAuthorizer = function (authConfig) {
        return apiGateWay.deleteAuthorizerPromise({
            authorizerId: authConfig.id,
            restApiId: apiId
        })
    }
    const getAuthorizerType = function (authConfig) {
        return authConfig.type || (authConfig.providerARNs ? 'COGNITO_USER_POOLS' : 'TOKEN')
    }
    const getAuthorizerArn = function (authConfig) {
        if (authConfig.lambdaArn) {
            return Promise.resolve(authConfig.lambdaArn)
        } else if (authConfig.lambdaName) {
            return lambda.getFunctionConfiguration({FunctionName: authConfig.lambdaName}).promise()
                .then(lambdaConfig => {
                    let suffix = '';
					if (authConfig.lambdaVersion === true) {
						suffix = ':${stageVariables.lambdaVersion}';
					} else if (authConfig.lambdaVersion) {
						suffix = ':' + authConfig.lambdaVersion;
					}
					return lambdaConfig.FunctionArn + suffix;
                })
        } else {
            return Promise.reject(`无法通过授权者 ${JSON.stringify(authConfig)} 找回 Lambda arn`)
        }
    }
    const allowInvocation = function (authConfig) {
        let authLambdaQualifier
        if (authConfig.lambdaVersion && (typeof authConfig.lambdaVersion === 'string')) {
            authLambdaQualifier = authConfig.lambdaVersion
        } else if (authConfig.lambdaVersion === true) {
            authLambdaQualifier = functionVersion
        }
        if (authConfig.lambdaName) {
            return allowApiInvocation(authConfig.lambdaName, authLambdaQualifier, apiId, ownerAccount, awsPartition, awsRegion, 'authorizers/*');

        } else {
            return Promise.resolve()
        }
    }
    const configureAuthorizer = function (authConfig, lambdaArn, authName) {
        const type = getAuthorizerType(authConfig)
        const identityHeader = 'method.request.header.' + (authConfig.headerName || 'Authorization')
        const identitySource = authConfig.identitySource || identityHeader
        const params = {
            identitySource: identitySource,
            name: authName,
            restApiId: apiId,
            type: type
        }
        if (type === 'COGNITO_USER_POOLS') {
            params.providerARNs = authConfig.providerARNs
        } else {
            params.authorizerUri = 'arn:' + awsPartition + ':apigateway:' + awsRegion + ':lambda:path/2015-03-31/functions/' + lambdaArn + '/invocations'
        }
        if (authConfig.validationExpression) {
            params.identityValidationExpression = authConfig.validationExpression
        }
        if (authConfig.credentials) {
            params.authorizerCredentials = authConfig.credentials
        }
        if (Number.isInteger(authConfig.resultTtl)) {
            params.authorizerResultTtlInSeconds = authConfig.resultTtl;
        }
        return params
    }
    const initializeAuthorizeConfigure = function (authName) {
        const authConfig = authorizerMap[authName]
        if (getAuthorizerType[authConfig] === 'COGNITO_USER_POOLS') {
            return Promise.resolve(configureAuthorizer(authConfig, null, authName))
        } else {
            return allowInvocation(authConfig)
                .then(() => getAuthorizerArn(authConfig))
                .then(lambdaArn => configureAuthorizer(authConfig, lambdaArn, authName))
        }
    }
    const addAuthorizer = function (authName) {
        return initializeAuthorizeConfigure(authName)
            .then(configuration => apiGateWay.createAuthorizerPromise(configuration))
            .then(result => result.id)
    }

    const authorizerNames = Object.keys(authorizerMap)

    return apiGateWay.getAuthorizersPromise({restApiId: apiId})
        .then(existingAuthorizers => sequentialPromiseMap(existingAuthorizers.items, removeAuthorizer))
        .then(() => sequentialPromiseMap(authorizerNames, addAuthorizer))
        .then(creationResults => {
            let index 
            const result = {}
            for (index = 0; index < authorizerNames.length; index++) {
                result[authorizerNames[index]] = creationResults[index]
            }
            return result
        })
}