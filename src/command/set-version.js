/**
 * 设置代码版本
 */

const aws = require('aws-sdk')
const loadConfig = require('../util/load-config')
const allowApiInvocation = require('../aws/allow-api-invocation')
const retriableWrap = require('../util/retriable-wrap')
const entityWrap = require('../util/entity-wrap')
const readEnvVarsFromOptions = require('../util/read-env-vars-from-options')
const updateEnvVars = require('../util/update-env-vars')
const apiGWUrl = require('../util/api-url')
const NullLogger = require('../util/null-logger')
const markAlias = require('../util/mark-alias')
const getOwnerInfo = require('../aws/get-own-info')

module.exports = function setVersion(options, optionalLogger) {
    let lambdaConfig, lambda, apiGateway, apiConfig
    const logger = optionalLogger || new NullLogger()
    
    const updateApi = function () {
        return getOwnerInfo(options.region, logger)
            .then(ownerInfo => allowApiInvocation(lambdaConfig.name, options.version, apiConfig.id, ownerInfo.account, ownerInfo.partition, lambdaConfig.region))
            .then(() => apiGateway.createDeploymentPromise({
                restApiId: apiConfig.id,
                stageName: options.version,
                variables: {
                    lambdaVersion: options.version
                }
            }))
            .then(() => ({url: apiGWUrl(apiConfig.id, lambdaConfig.region, options.version)}))
    }
    const updateConfiguration = function () {
        logger.logStage('更新配置')
        return Promise.resolve()
            .then(() => lambda.getFunctionConfiguration({FunctionName: lambdaConfig.name}).promise())
            .then(functionConfiguration => updateEnvVars(options, lambda, lambdaConfig.name, functionConfiguration.Environment && functionConfiguration.Environment.variables))
    }

    if (!options.version) { 
        return Promise.reject('版本信息未指定，请使用 --version 指定版本')
    }
    try {
        readEnvVarsFromOptions(options)
    } catch (e) {
        return Promise.reject(e)
    }

    logger.logStage('加载配置')
    return  loadConfig(options, {lambda: {name: true, region: true}})
        .then(config => {
            lambdaConfig = config.lambda
            apiConfig = config.api
            lambda = entityWrap(new aws.Lambda({region: lambdaConfig.region}), {log: logger.logApiCall, logName: 'lambda'})
            apiGateway = retriableWrap(
                entityWrap(
                    new aws.APIGateway({region: lambdaConfig.region}),
                    {log: logger.logApiCall, logName: 'apigateway'}
                ),
                () => logger.logStage('AWS限制速率， 稍后重试')
            )
        })
        .then(updateConfiguration)
        .then(() => {
            logger.logStage('更新版本')
            return lambda.publishVersion({FunctionName: lambdaConfig.name}).promise()
        })
        .then(versionResult => markAlias(lambdaConfig.name, lambda, versionResult.Version, options.version))
        .then(() => {
            if (apiConfig && apiConfig.id) {
                return updateApi()
            }
        })
}

module.exports.doc = {
	description: '创建或更新lambda、api状态，以指向最新的部署版本',
	priority: 3,
	args: [
		{
			argument: 'version',
			description: '更新或创建的别名',
			example: 'production'
		},
		{
			argument: 'source',
			optional: true,
			description: '项目文件路径',
			default: 'current directory'
		},
		{
			argument: 'config',
			optional: true,
			description: '包含资源名称的配置文件',
			default: 'sln.json'
		},
		{
			argument: 'update-env',
			optional: true,
			description: '以Key=Value的形式，设置或更新环境变量',
			example: 'S3BUCKET=testbucket,SNSQUEUE=testqueue'
		},
		{
			argument: 'set-env',
			optional: true,
			example: 'S3BUCKET=testbucket,SNSQUEUE=testqueue',
			description: '以Key=Value的形式，重新设置环境变量'
		},
		{
			argument: 'update-env-from-json',
			optional: true,
			example: 'production-env.json',
			description: '从指定的JSON文件中读取更新环境变量'
		},

		{
			argument: 'set-env-from-json',
			optional: true,
			example: 'production-env.json',
			description: '从指定的JSON文件中重新设置环境变量.'
		},
		{
			argument: 'env-kms-key-arn',
			optional: true,
			description: 'arn 加密解密的环境变量'
		}
	]
}