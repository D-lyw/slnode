/**
 * 测试Lambda函数
 */


const aws = require('aws-sdk')
const loadConfig = require('../util/load-config')
const fsPromise = require('fs').promises

module.exports = function testLambda (options) {
    let lambdaConfig
    const getPayload = function () {
        if (!options.event) {
            return Promise.resolve('')
        } else {
            return fsPromise.readFile(options.event, 'utf-8')
        }
    }

    return loadConfig(options, {lambda: {name: true, region: true}})
        .then(config => {
            lambdaConfig = config.lambda
        })
        .then(getPayload)
        .then(payload => {
            const lambda = new aws.Lambda({region: lambdaConfig.region})
            return lambda.invoke({FunctionName: lambdaConfig.name, Payload: payload, Qualifier: options.version}).promise()
        })
}

module.exports.doc = {
	description: '执行Lambda函数并打印输出结果',
	priority: 8,
	args: [
		{
			argument: 'event',
			optional: true,
			description: '指定包含json测试事件文件的路径'
		},
		{
			argument: 'version',
			optional: true,
			description: '指定测试的版本别名',
			default: 'latest version'
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
			description: '指定配置文件名称',
			default: 'sln.json'
		}
	]
}