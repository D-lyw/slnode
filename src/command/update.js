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


module.exports = function update (options, optionalLoGger) {
    let lambda, s3, iam, apiGateway, lambdaConfig, apiConfig, updateResult, 
        functionConfig, packageDir, packageArchive, s3Key,
        ownerAccount, awsPartition, workingDir, requiresHandlerUpdate = false

    const logger = optionalLogger || new NullLogger()
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
            lambdaConfig = config.lambdaVersion
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
                    logger.logStage('patching IAM polic')
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
	description: 'Deploy a new version of the Lambda function using project files, update any associated web APIs',
	priority: 2,
	args: [
		{
			argument: 'version',
			optional: true,
			description: 'A version alias to automatically assign to the new deployment',
			example: 'development'
		},
		{
			argument: 'source',
			optional: true,
			description: 'Directory with project files',
			default: 'current directory'
		},
		{
			argument: 'config',
			optional: true,
			description: 'Config file containing the resource names',
			default: 'claudia.json'
		},
		{
			argument: 'timeout',
			optional: true,
			description: 'The function execution time, in seconds, at which AWS Lambda should terminate the function'
		},
		{
			argument: 'runtime',
			optional: true,
			description: 'Node.js runtime to use. For supported values, see\n http://docs.aws.amazon.com/lambda/latest/dg/API_CreateFunction.html'
		},
		{
			argument: 'memory',
			optional: true,
			description: 'The amount of memory, in MB, your Lambda function is given.\nThe value must be a multiple of 64 MB.'
		},
		{
			argument: 'no-optional-dependencies',
			optional: true,
			description: 'Do not upload optional dependencies to Lambda.'
		},
		{
			argument: 'use-local-dependencies',
			optional: true,
			description: 'Do not install dependencies, use local node_modules directory instead'
		},
		{
			argument: 'npm-options',
			optional: true,
			description: 'Any additional options to pass on to NPM when installing packages. Check https://docs.npmjs.com/cli/install for more information',
			example: '--ignore-scripts',
			since: '5.0.0'
		},
		{
			argument: 'cache-api-config',
			optional: true,
			example: 'claudiaConfigCache',
			description: 'Name of the stage variable for storing the current API configuration signature.\n' +
				'If set, it will also be used to check if the previously deployed configuration can be re-used and speed up deployment'
		},
		{
			argument: 'post-package-script',
			optional: true,
			example: 'customNpmScript',
			description: 'the name of a NPM script to execute custom processing after claudia finished packaging your files.\n' +
				'Note that development dependencies are not available at this point, but you can use npm uninstall to remove utility tools as part of this step.',
			since: '5.0.0'
		},
		{
			argument: 'keep',
			optional: true,
			description: 'keep the produced package archive on disk for troubleshooting purposes.\n' +
				'If not set, the temporary files will be removed after the Lambda function is successfully created'
		},
		{
			argument: 'use-s3-bucket',
			optional: true,
			example: 'claudia-uploads',
			description: 'The name of a S3 bucket that Claudia will use to upload the function code before installing in Lambda.\n' +
			'You can use this to upload large functions over slower connections more reliably, and to leave a binary artifact\n' +
			'after uploads for auditing purposes. If not set, the archive will be uploaded directly to Lambda.\n'
		},
		{
			argument: 's3-key',
			optional: true,
			example: 'path/to/file.zip',
			description: 'The key to which the function code will be uploaded in the s3 bucket referenced in `--use-s3-bucket`'
		},
		{
			argument: 's3-sse',
			optional: true,
			example: 'AES256',
			description: 'The type of Server Side Encryption applied to the S3 bucket referenced in `--use-s3-bucket`'
		},
		{
			argument: 'update-env',
			optional: true,
			example: 'S3BUCKET=testbucket,SNSQUEUE=testqueue',
			description: 'comma-separated list of VAR=VALUE environment variables to set, merging with old variables'
		},
		{
			argument: 'set-env',
			optional: true,
			example: 'S3BUCKET=testbucket,SNSQUEUE=testqueue',
			description: 'comma-separated list of VAR=VALUE environment variables to set. replaces the whole set, removing old variables.'
		},
		{
			argument: 'update-env-from-json',
			optional: true,
			example: 'production-env.json',
			description: 'file path to a JSON file containing environment variables to set, merging with old variables'
		},

		{
			argument: 'set-env-from-json',
			optional: true,
			example: 'production-env.json',
			description: 'file path to a JSON file containing environment variables to set. replaces the whole set, removing old variables.'
		},
		{
			argument: 'env-kms-key-arn',
			optional: true,
			description: 'KMS Key ARN to encrypt/decrypt environment variables'
		},
		{
			argument: 'layers',
			optional: true,
			description: 'A comma-delimited list of Lambda layers to attach to this function. Setting this during an update replaces all previous layers.',
			example: 'arn:aws:lambda:us-east-1:12345678:layer:ffmpeg:4'
		},
		{
			argument: 'add-layers',
			optional: true,
			description: 'A comma-delimited list of additional Lambda layers to attach to this function. Setting this during an update leaves old layers in place, and just adds new layers.',
			example: 'arn:aws:lambda:us-east-1:12345678:layer:ffmpeg:4'
		},
		{
			argument: 'remove-layers',
			optional: true,
			description: 'A comma-delimited list of Lambda layers to remove from this function. It will not remove any layers apart from the ones specified in the argument.',
			example: 'arn:aws:lambda:us-east-1:12345678:layer:ffmpeg:4'
		},
		{
			argument: 'dlq-sns',
			optional: true,
			description: 'Dead letter queue SNS topic name or ARN',
			example: 'arn:aws:sns:us-east-1:123456789012:my_corporate_topic'
		},
		{
			argument: 'skip-iam',
			optional: true,
			description: 'Do not try to modify the IAM role for Lambda',
			example: 'true'
		},
		{
			argument: 'aws-delay',
			optional: true,
			example: '3000',
			description: 'number of milliseconds betweeen retrying AWS operations if they fail',
			default: '5000'
		},
		{
			argument: 'aws-retries',
			optional: true,
			example: '15',
			description: 'number of times to retry AWS operations if they fail',
			default: '15'
		}
	]
}

/**
 * 去除 getSnsDLQTopic 函数
 * 
 * 去除 updateConfiguration 函数中关于参数 ‘add-layers',' remove-layers' 和’dlq-sns'的判断
 */


