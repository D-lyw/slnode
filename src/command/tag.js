/**
 * 为函数添加标记
 */

const aws = require('aws-sdk')
const loadConfig = require('../util/load-config')
const getOwnerInfo = require('../aws/get-own-info')
const parseKeyValueCSV = require('../util/parse-key-value-csv')

module.exports = function tag(options) {
    let lambdaConfig,
        lambda,
        apiConfig,
        awsPartition,
        region,
        api;

    const initService = function () {
        lambda = new aws.Lambda({region: lambdaConfig.region})
        api = new aws.APIGateway({region: lambdaConfig.region})
    }
    const getLambda = () => lambda.getFunctionConfiguration({FunctionName: lambdaConfig.name, Qualifier: options.version}).promise() 
    const readConfig = function () {
        return loadConfig(options, {lambda: {name: true, region: true}})
            .then(config => {
                lambdaConfig = config.lambda
                apiConfig = config.api 
                region = config.region
            })
            .then(initService)
            .then(getLambda)
            .then(result => {
                lambdaConfig.arn = result.FunctionArn
                lambdaConfig.version = result.Version 
            })
            .then(() => getOwnerInfo(region))
            .then(ownerInfo => {
                awsPartition = ownerInfo.partition 
            })
    }
    const tagLambda = function (tags) {
        return lambda.tagResource({
            Resource: lambdaConfig.arn,
            Tag: tags 
        }).promise()
    }
    const tagApi = function (tags) {
        if (apiConfig && apiConfig.id) {
            return api.tagResource({
                resourceArn: `arn:${awsPartition}:apigateway:${lambdaConfig.region}::/restapis/${apiConfig.id}`,
                tags: tags 
            }).promise()
        }
    }
    const tag = function (tags) {
        return tagLambda(tags)
            .then(() => tagApi(tags))
    }

    if (!options.tags) {
        return Promise.reject('没有 tag 值被指定')
    }
    return readConfig()
        .then(() => tag(parseKeyValueCSV(options.tags)))
}


module.exports.doc = {
	description: '以键值对的形式将标签添加到Lambda函数和与之关联的Web api上',
	priority: 22,
	args: [
		{
			argument: 'tags',
			example: 'Team=onboarding,Project=amarillo',
			description: '指定添加到Lambda函数上的标签列表'
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
			description: '指定包含资源名称的配置文件',
			default: 'sln.json'
		}
	]
}