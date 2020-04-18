/**
 * 更新项目代码
 */

const aws = require('aws-sdk')
const os = require('os')
const path = require('path')
const fs = require('fs')
const fsPromise = require('fs').promises
const fsUtils = require('../util/fs-utils')
const retry = require('oh-no-i-insist')
const NullLogger = require('../util/null-logger')
const allowApiInvocation = require('../aws/allow-api-invocation')
const rebuildWebApi = require('../aws/rebuild-web-api')
const apiGWUrl = require('../util/api-url')
const initEnvVarsFromOptions = require('../util/init-env-vars-from-options')
const getOwnerInfo = require('../aws/get-own-info')
const loadConfig = require('../util/load-config')
const entityWrap = require('../util/entity-wrap')
const retriableWrap = require('../util/retriable-wrap')
const collectFiles = require('../aws/collect-files')
const validatePackage = require('../util/validate-package')
const cleanUpPackage = require('../util/cleanUpPackage')
const snsPublishPolicy = require('../aws/sns-publish-policy')
const updateEnvVars = require('../util/update-env-vars')
const zipdir = require('../util/zipdir')
const markAlias = require('../util/mark-alias')
const lambdaCode = require('../util/lambdaCode')


module.exports = function update (options, optionalLoGger) {
    let lambda, s3, iam, apiGateway, lambdaConfig, apiConfig, updateResult, 
        functionConfig, packageDir, packageArchive, s3Key,
        ownerAccount, awsPartition, workingDir, requiresHandlerUpdate = false

    const logger = optionalLoGger || new NullLogger()
    const awsDelay = options && options['aws-delay'] && parseInt(options['aws-delay'], 10) || (process.env.AWS_DELAY && parseInt(process.env.AWS_DELAY, 10))
    const awsRetries = options && options['aws-retries'] && parseInt(options['aws-retries'], 10) || 15
    const alias = (options && options.version) || 'latest'

    const updateProxyApi = function () {
        return allowApiInvocation(lambda.name, alias, apiConfig.id, ownerAccount, awsPartition, lambdaConfig.region)
            .then(() => apiGateway.createDeploymentPromise({
                restApiId: apiConfig.id,
                stageName: alias,
                variables: {
                    lambdaVersion: alias
                }
            }))
    }
    // 更新加载api配置
    const updateSlnApiBuilderApi = function () {
        let apiModule, apiDef, apiModulePath
        try {
            apiModulePath = path.resolve(path.join(packageDir, apiConfig.module))
            apiModule = require(apiModulePath)
            apiDef = apiModule.apiConfig()
        } catch (e) {
            console.error(e.stack || e)
            return Promise.reject(`无法从 ${apiModulePath} 加载api配置`)
        }

        return rebuildWebApi(lambdaConfig.name, alias, apiConfig.id, apiDef, ownerAccount, awsPartition, lambdaConfig.region, logger, options['cache-api-config'])
            .then(rebuildResult => {
                if (apiModule.postDeploy) {
                    return apiModule.postDeploy(
                        options,
                        {
                            name: lambdaConfig.name,
							alias: alias,
							apiId: apiConfig.id,
							apiUrl: updateResult.url,
							region: lambdaConfig.region,
							apiCacheReused: rebuildResult.cacheReused
                        },
                        {
                            apiGatewayPromise: apiGateway,
                            aws: aws 
                        }
                    )
                }
            })
            .then(postDeployResult => {
                if (postDeployResult) {
                    updateResult.deploy = postDeployResult
                }
            })
    }

    // 更新web api
    const updateWebApi = function () {
        if (apiConfig && apiConfig.id) {
            logger.logStage('更新 REST Api')
            updateResult.url = apiGWUrl(apiConfig.id, lambdaConfig.region, alias)
            if (apiConfig.module) {
                return updateSlnApiBuilderApi()
            } else {
                return updateProxyApi()
            }
        }
    }


    // 去除部分
    // --------------------------------
    const getSnsDLQTopic = function () {
        const topicNameOrArn = options['dlq-sns'];
        if (!topicNameOrArn) {
            return false;
        }
        if (isSNSArn(topicNameOrArn)) {
            return topicNameOrArn;
        }
        return `arn:${awsPartition}:sns:${lambdaConfig.region}:${ownerAccount}:${topicNameOrArn}`;
    }
    // -----------------------------------------


    // 更新配置
    const updateConfiguration = function (newHandler) {
        const configurationPath = {}
        logger.logStage('更新配置')
        if (newHandler) {
            configurationPath.Handler = newHandler
        }
        if (options.timeout) {
            configurationPath.Timeout = options.timeout
        }
        if (options.runtime) {
            configurationPath.Runtime = options.runtime
        }
        if (options.memory) {
            configurationPath.MemorySize = options.memory
        }
        if (options.layers) {
            configurationPath.Layers = options.layers.split(',')
        }
        if (Object.keys(configurationPath).length > 0) {
            configurationPath.FunctionName = lambdaConfig.name
            return retry(
                () => {
                    return lambda.updateFunctionConfiguration(configurationPath).promise()
                },
                awsDelay,
                awsRetries,
                error => {
                    return error && error.code === 'InvalidParameterValueException'
                },
                () => logger.logStage('等待 IAM 角色生效'),
                Promise
            )
        }
    }

    // 清除内容
    const cleanup = function () {
        if (!options.keep) {
            fs.unlinkSync(packageArchive)
            fsUtils.rmDir(workingDir)
        } else {
            updateResult.archive = packageArchive
        }
        return updateResult
    }

    // 校验参数
    const validateOptions = function () {
        if (!options.source) {
            options.source = process.cwd()
        }
        if (options.source === os.tmpdir()) {
            return Promise.reject('项目路径为Node临时存储目录，无法进行操作')
        }
        if (options['optional-dependencies'] === false && options['use-local-dependencies']) {
            return Promise.reject('--use-local-dependencies 和 --no-optional-dependencies 参数冲突');
        }
        if (options.timeout || options.timeout === 0) {
            if (options.timeout < 1) {
                return Promise.reject('提供的超时时间必须大于等于 1');
            }
            if (options.timeout > 900) {
                return Promise.reject('提供的超时时间必须小于等于900');
            }
        }
        if (options.memory || options.memory === 0) {
            if (options.memory < 128) {
                return Promise.reject(`提供的内存值必须大于最小值 128`);
            }
            if (options.memory > 3000) {
                return Promise.reject(`提供的内存值必须小于允许的最大值 3000`);
            }
            if (options.memory % 64 !== 0) {
                return Promise.reject('提供的值必须是64的整数倍');
            }
        }
        if (options['s3-key'] && !options['use-s3-bucket']) {
            return Promise.reject('--s3-key 必须和 --use-s3-bucket 配合使用');
        }
        return  Promise.resolve()
    }

    options = options || {}

    return validateOptions()
        .then(() => {
            logger.logStage('加载 Lambda 配置信息')
            return initEnvVarsFromOptions(options)
        })
        .then(() => getOwnerInfo(options.region, logger))
        .then(ownerInfo => {
            ownerAccount = ownerInfo.ownerAccount
            awsPartition = ownerInfo.partition
        })
        .then(() => loadConfig(options, {lambda: {name: true, region: true}}))
        .then(config => {
            lambdaConfig = config.lambda
            apiConfig = config.api 
            lambda = entityWrap(new aws.Lambda({region: lambdaConfig.region}), {log: logger.logApiCall, logName: 'lambda'})
            s3 = entityWrap(new aws.S3({region: lambdaConfig.region, signatureVersion: 'v4'}), {log: logger.logApiCall, logName: 's3'})
            iam = entityWrap(new aws.IAM({region: lambdaConfig.region}), {log: logger.logApiCall, logName: 'iam'})
            apiGateway = retriableWrap(
                entityWrap(
                    new aws.APIGateway({region: lambdaConfig.region}),
                    {log: logger.logApiCall, logName: 'apigateway'}
                ),
                () => logger.logStage('AWS限制速率， 稍后重试')
            )
        })
        .then(() => lambda.getFunctionConfiguration({FunctionName: lambdaConfig.name}).promise())
        .then(result => {
            functionConfig = result
            requiresHandlerUpdate = apiConfig && apiConfig.id && /\.router$/.test(functionConfig.Handler)
            if (requiresHandlerUpdate) {
                functionConfig.Handler = functionConfig.Handler.replace(/\.router$/, '.proxyRouter')
            } else if (options.Handler) {
                functionConfig.Handler = options.handler 
                requiresHandlerUpdate = true
            }
        })
        .then(() => {
            if (apiConfig) {
                return apiGateway.getRestApiPromise({restApiId: apiConfig.id})
            }
        })
        .then(() => fsPromise.mkdtemp(os.tmpdir() + path.sep))
        .then(dir => workingDir = dir)
        .then(() => collectFiles(options.source, workingDir, options, logger))
        .then(dir => {
            logger.logStage('校验压缩包')
            return validatePackage(dir, functionConfig.Handler, apiConfig && apiConfig.module)
        })
        .then(dir => {
            packageDir = dir
            return cleanUpPackage(dir, options, logger)
        })
        .then(() => {
            if (!options['skip-iam']) {
                if (getSnsDLQTopic()) {
                    logger.logStage('修补 IAM 策略')
                    const policyUpdate = {
                        RoleName: lambdaConfig.role,
                        PolicyName: 'dlq-publisher',
                        PolicyDocument: snsPublishPolicy(getSnsDLQTopic())
                    }
                    return iam.putRolePolicy(policyUpdate).promise()
                }
            }
        })
        .then(() => {
            return updateConfiguration(requiresHandlerUpdate && functionConfig.Handler)
        })
        .then(() => {
            return updateEnvVars(options, lambda, lambdaConfig.name, functionConfig.Environment && functionConfig.Environment.Variables)
        })
        .then(() => {
            logger.logStage('压缩项目代码')
            return zipdir(packageDir)
        })
        .then(zipFile => {
            packageArchive = zipFile
            return lambdaCode(s3, packageArchive, options['use-s3-bucket'], options['s3-sse'], options['s3-key'])
        })
        .then(functionCode => {
            logger.logStage('更新 Lambda 函数')
            s3Key = functionCode.S3Key 
            functionCode.FunctionName = lambdaConfig.name
            functionCode.Publish = true
            return lambda.updateFunctionCode(functionCode).promise()
        })
        .then(result => {
            updateResult = result
            if (s3Key) {
                updateResult.s3Key = s3Key
            }
            return result
        })
        .then(result => {
            if (options.version) {
                logger.logStage('设置 版本别名')
                return markAlias(result.FunctionName, lambda, result.Version, options.version)
            }
        })
        .then(updateWebApi)
        .then(cleanup)
}

module.exports.doc = {
	description: '更新部署一个新版本的Lambda函数以及相关的Web Api.',
	priority: 2,
	args: [
		{
			argument: 'version',
			optional: true,
			description: '自动分配给新部署的版本别名',
			example: 'development'
		},
		{
			argument: 'source',
			optional: true,
			description: '项目文件目录',
			default: 'current directory'
		},
		{
			argument: 'config',
			optional: true,
			description: '指定包含资源名称的配置文件',
			default: 'sln.json'
		},
		{
			argument: 'timeout',
			optional: true,
			description: 'Lambda函数执行的最大时间（s）'
		},
		{
			argument: 'runtime',
			optional: true,
			description: '指定Node.js的运行版本'
		},
		{
			argument: 'memory',
			optional: true,
			description: '指定Lambda函数运行分配的最大内存空间.'
		},
		{
			argument: 'no-optional-dependencies',
			optional: true,
			description: '不将可选依赖上传到Lambda'
		},
		{
			argument: 'use-local-dependencies',
			optional: true,
			description: '不安装依赖，使用本地node_modules文件夹中依赖代替'
		},
		{
			argument: 'npm-options',
			optional: true,
			description: '安装软件包时，传给npm的任何其他参数. ',
			example: '--ignore-scripts',
			since: '5.0.0'
		},
		{
			argument: 'cache-api-config',
			optional: true,
			example: 'slnConfigCache',
			description: '用于存储当前API配置签名的阶段变量的名称'
		},
		{
			argument: 'keep',
			optional: true,
			description: '将产生的软件包保留在磁盘上，而不在成功上传后，进行删除'
		},
		{
			argument: 'use-s3-bucket',
			optional: true,
			example: 'sln-uploads',
			description: '使用S3桶服务'
		},
		{
			argument: 's3-key',
			optional: true,
			example: 'path/to/file.zip',
			description: '指定s3桶加密的秘钥'
		},
		{
			argument: 's3-sse',
			optional: true,
			example: 'AES256',
			description: '指定应用于 --use-s3-bucket 中引用的S3存储桶的服务器端加密类型'
		},
		{
			argument: 'update-env',
			optional: true,
			example: 'S3BUCKET=testbucket,SNSQUEUE=testqueue',
			description: '以键值对的形式，更新环境变量'
		},
		{
			argument: 'set-env',
			optional: true,
			example: 'S3BUCKET=testbucket,SNSQUEUE=testqueue',
			description: '以键值对的形式，设置环境变量'
		},
		{
			argument: 'update-env-from-json',
			optional: true,
			example: 'production-env.json',
			description: '根据指定JSON文件内容，更新环境变量'
		},

		{
			argument: 'set-env-from-json',
			optional: true,
			example: 'production-env.json',
			description: '根据指定JSON文件内容，重新设置环境变量'
		},
		{
			argument: 'env-kms-key-arn',
			optional: true,
			description: 'KMS密钥ARN用于加密/解密环境变量'
		},
		{
			argument: 'skip-iam',
			optional: true,
			description: '不要尝试修改Lambda的IAM角色',
			example: 'true'
		},
		{
			argument: 'aws-delay',
			optional: true,
			example: '3000',
			description: 'AWS操作失败，等待重试的毫秒数',
			default: '5000'
		},
		{
			argument: 'aws-retries',
			optional: true,
			example: '15',
			description: 'AWS操作失败重试的最大次数',
			default: '15'
		}
	]
}

/**
 * 去除 getSnsDLQTopic 函数
 * 
 * 去除 updateConfiguration 函数中关于参数 ‘add-layers',' remove-layers' 和’dlq-sns'的判断
 */


