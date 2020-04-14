/**
 * 销毁部署的Lambda函数和相关函数
 */

const aws = require('aws-sdk')
const path = require('path')
const loadConfig = require('../util/load-config')
const fsPromise = require('fs').promises
const retriableWrap = require('../util/retriable-wrap')
const destroyRole = require('../util/destroy-role')

module.exports = function destroy (options) {
    let lambdaConfig, apiConfig

    return loadConfig(options, {lambda: {name: true, region: true, role: true}})
        .then(config => {
            lambdaConfig = config.lambda
            apiConfig = config.api 
        })
        .then(() => {
            const lambda = new aws.Lambda({region: lambdaConfig.region})
            return lambda.deleteFunction({FunctionName: lambdaConfig.name}).promise()
        })
        .then(() => {
            const apiGateway = retriableWrap(new aws.APIGateway({region: lambdaConfig.region}))
            if (apiConfig) {
                return apiGateway.deleteRestApiPromise({
                    restApiId: apiConfig.id 
                })
            }
        })
        .then(() => {
            const iam = new aws.IAM({region: lambdaConfig.region})
            if (lambdaConfig.role && !lambdaConfig.sharedRole) {
                return destroyRole(iam, lambdaConfig.role)
            }
        })
        .then(() => {
            const sourceDir = (options && options.source) || process.cwd()
            const fileName = (options && options.config) || path.join(sourceDir, 'sln.json')
            return fsPromise.unlink(fileName)
        })
}

module.exports.doc = {
	description: '取消部署lambda函数并销毁API和安全角色',
	priority: 9,
	args: [
		{
			argument: 'source',
			optional: true,
			description: '指定项目文件目录',
			default: '当前目录'
		},
		{
			argument: 'config',
			optional: true,
			description: '指定配置文件名称',
			default: 'sln.json'
		}
	]
}