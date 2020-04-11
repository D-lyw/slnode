/**
 * command: create
 * 创建初始化Lambda函数
 */
const aws = require('aws-sdk')
const path = require('path')
const fs = require('fs')
const fsPromise = fs.promises
const os = require('os')
const retry = require('oh-no-i-insist')
const NullLogger = require('../util/null-logger')
const entityWrap = require('../util/entity-wrap')
const fsUtils = require('../util/fs-utils')
const judgeRole = require('../util/judge-role')
const retriableWrap = require('../util/retriable-wrap')
const readJson = require('../util/read-json')
const markAlias = require('../util/mark-alias')
const apiGWUrl = require('../util/api-url')
const rebuildWebApi = require('../aws/rebuild-web-api')
const lambdaExecutorPolicy = require('../aws/lambda-executor-policy')
const addPolicy = require('../util/add-policy')
const initEnvVarsFromOptions = require('../util/init-env-vars-from-options')
const getOwnerInfo = require('../aws/get-own-info')
const collectFiles = require('../aws/collect-files')
const validatePackage = require('../util/validate-package')
const cleanUpPackage = require('../util/cleanUpPackage')
const zipdir = require('../util/zipdir')
const loggingPolicy = require('../aws/logging-policy')
const snsPublishPolicy = require('../aws/sns-publish-policy')
const lambadCode = require('../util/lambdaCode')
const deployProxyApi = require('../aws/deploy-proxy-api')

module.exports.create = function(options, optionalLogger) {
    let roleMetadata,
        s3Key,
        packageArchive,
        functionDesc,
        customEnvVars,
        functionName
        workingDir,
        ownerAccount,
        awsPartition,
        packageFileDir

    const logger = optionalLogger || new NullLogger()

    // 结合传入参数和默认值设置AWS Lambda相关参数值
    const awsDelay = options && options['aws-delay'] && parseInt(options['aws-delay'], 10)
        || (process.env.AWS_DELAY && parseInt(process.env.AWS_DELAY, 10)) 
        || 5000
    const awsRetries = options && options['aws-retries'] && parseInt(options['aws-retries'], 10) || 5
    const source = options && options.source || process.cwd()
    const configFile = options && options.config || path.join(source, 'sln.json'),
    
    const iam = entityWrap(new aws.IAM({region: options.region}), {log: logger.logApiCall, logName: 'iam'})
    const lambda = entityWrap(new aws.Lambda({region: options.region}), {log: logger.logApiCall, logName: 'lambda'})
    const s3 = entityWrap(new aws.S3({region: options.region, signatureVersion: 'v4'}), {log: logger.logApiCall, logName: 's3'} )

    // 准备删除部分
    // --------------------------
    getSnsDLQTopic = function () {
			const topicNameOrArn = options['dlq-sns'];
			if (!topicNameOrArn) {
				return false
            }
            return false
			if (isSNSArn(topicNameOrArn)) {
				return topicNameOrArn;
			}
			return `arn:${awsPartition}:sns:${options.region}:${ownerAccount}:${topicNameOrArn}`;
		}
    // --------------------------
    
    // 创建AWS网关api
    const apiGatewayPromise = retriableWrap(
        entityWrap(new aws.APIGateway({region: options.region}), {log: logger.logApiCall, logName: 'apigateway'}),
        () => logger.logStage(`AWS限制速率，稍后重试`)
    )

    // 处理policy文件所在路径
    const policyFiles = function () {
        let files = fsUtils.recursiveList(options.policies)
        if (fsUtils.isDir(options.policies)) {
            files = files.map(filePath => path.join(options.policies, filePath))
        }
        return files.filter(fsUtils.isFile)
    }

    // 错误参数信息处理
    const validationError = function () {
        if (!options.region) {
            return `AWS region 参数未定义，请使用 --region 定义该参数值`
        }
        if (!options.handler && !options['api-module']) {
            return 'Lambda handler 参数未定义，请使用 --handler 定义该参数值'
        }
        if (options.handler && options['api-module']) {
            return `不能同时使用 handler 和 api-module 两个参数`
        }
        if (!options.handler && options['deploy-proxy-api']) {
            return `deploy-proxy-api 需要一个 handler，请使用 --handler 定义该参数值`
        }
        if (options.handler && options.handler.indexOf('.') < 0)  {
            return `未指定 Lambda 处理函数，请使用 --handler 指定函数`
        }
        if (options['api-module'] && options['api-module'].indexOf('.') >= 0) {
            return `Api module 模块名不能和已存在的文件名或函数名重名`
        }

        if (!fsUtils.isDir(path.dirname(configFile))) {
            return `无法将内容写入 ${configFile}`
        }
        if (fsUtils.fileExists(configFile)) {
            if (options && options.config) {
                return `${options.config} + 已存在`
            }
            return 'sln.json 已经在项目文件夹下'
        }
        if (!fsUtils.fileExists(path.join(source, 'package.json'))) {
            return `项目目录下不存在 package.json 文件`
        }
        if (options.policies && !policyFiles().length) {
            return `没有文件匹配 ${options.policies}`
        }
        if (options.memory || options.memory === 0) {
            if (options.memory < 128) {
                return `提供的内存值必须大于或等于 Lambda 限制的最小内存值`
            }
            if (options.memory > 3008) {
                return `提供的内存值必须小于或等于 Lambda 限制的最大内存值`
            }
            if (options.memory % 64 !== 0) {
                return `提供的内存值必须是64的整数倍`
            }
        }
        if (options.timeout || options.timeout === 0) {
            if (options.timeout < 1) {
                return `超时时间必须大于1`
            }
            if (options.timeout > 9000) {
                return `超时时间必须小于900`
            }
        }
        if (options['allow-recursion'] && options.role && judgeRole.isRoleArn(options.role)) {
            return `参数 allow-recursion 和 role 冲突`
        }
        if (options['s3-key'] && !options['use-s3-bucket']) {
            return `--s3-key 需要和 --use-s3-bucket 一起使用`
        }
    }

    // 获取package包信息
    const getPackageInfo = function () {
        logger.logStage('Loading package config')
        return readJson(path.join(source, 'package.json'))
            .then(jsonConfig => {
                const name = options.name || jsonConfig.name
                const description = options.description || (jsonConfig.description && jsonConfig.description.trim())
                if (!name) {
                    return Promise.reject('项目名称缺失，请在package.json或使用 --name 指定')
                }
                return {
                    name: name,
                    description: description
                }
            })
    }

    // 创建Lambda函数
    const createLambda = function (functionName, functionDesc, functionCode, roleArn) {
        return retry(
            () => {
                logger.logStage('creating Lambda')
                return lambda.createFunction({
                    Code: functionCode,
                    FunctionName: functionName,
                    Description: functionDesc,
                    MemorySize: options.memory,
                    Timeout: options.timeout,
                    Environment: customEnvVars,
                    KMSKeyArn: options['env-kms-key-arn'],
                    Handler: options.handler || (options['api-module'] + '.proxyRouter'),
                    Role: roleArn,
                    Runtime: options.runtime || 'nodejs12.x',
                    Publish: true,
                    Layers: options.Layers && options.Layers.split(',')
                }).promise()
            },
            awsDelay,
            awsRetries,
            error => {
                return error && error.code === 'InvalidParameterValueException'
            },
            () => logger.logStage('waiting for IAM role propagation'),
            Promise
        )
    }

    // 标记别名
    const markAliases = function (lambdaData) {
        logger.logStage('create version alias')
        return markAlias(lambdaData.FunctionName, lambda, '$LATEST', 'latest')
            .then(() => {
                if (options.version) {
                    return markAlias(lambdaData.FunctionName, lambda, lambdaData.Version, options.version)

                }
            })
            .then(() => lambdaData)
    }

    // 创建Web api
    const createWebApi = function (lambdaMetadata, packageDir) {
        let apiModule, apiConfig, apiModulePath
        const alias = options.version || 'latest'
        logger.logStage('creating REST Api')
        try {
            apiModulePath = path.join(packageDir, options['api-module'])
            apiModule = require(path.resolve(apiModulePath))
            apiConfig = apiModule && apiModule.apiConfig && apiModule.apiConfig()
        } catch (e) {
            console.error(e.stack || e)
            return Promise.reject(`无法从 ${apiModulePath} 加载api配置文件`)
        }

        if (!apiConfig) {
            return Promise.reject(`没有 apiConfig 定义在模块 ${options['api-module']}`)
        }

        return apiGatewayPromise.createRestApiPromise({
            name: lambdaMetadata.FunctionName
        })
        .then(result => {
            lambdaMetadata.api = {
                id: result.id,
                module: options['api-module'],
                url: apiGWUrl(result.id, options.region, alias)
            }
            return rebuildWebApi(lambdaMetadata.FunctionName, alias, result.id, apiConfig, ownerAccount, awsPartition, options.region, logger, options['cache-api-config'])
        })
        .then(() => {
            if (apiModule.postDeploy) {
                return apiModule.postDeploy(
                    options,
                    {
                        name: lambdaMetadata.FunctionName,
                        alias: alias,
                        apiId: lambdaMetadata.api.id,
                        apiUrl: lambdaMetadata.api.url,
                        region: options.region
                    },
                    {
                        apiGatewayPromise: apiGatewayPromise,
                        aws: aws
                    }
                )
            }
        })
        .then(postDeployResult => {
            if (postDeployResult) {
                lambdaMetadata.api.deploy = postDeployResult
            }
            return lambdaMetadata
        })
    }

    // 保存配置文件
    const saveConfig = function (lambdaMetadata) {
        const config = {
            lambda: {
                role: roleMetadata.Role.RoleName,
                name: lambdaMetadata.FunctionName,
                region: options.region
            }
        }
        if (options.role) {
            config.lambda.sharedRole = true
        }
        logger.logStage('saving configuration')
        if (lambdaMetadata.api) {
            config.api = { id: lambdaMetadata.api.id, module: lambdaMetadata.api.module}
        }
        return fsPromise.writeFile(
            configFile,
            JSON.stringify(config, null, 2),
            'utf8'
            )
            .then(() => lambdaMetadata)
    }

    // 格式化config内容
    const formatResult = function (lambdaMetadata) {
        const config = {
            lambda: {
                role: roleMetadata.Role.RoleName,
                name: lambdaMetadata.FunctionName,
                region: options.region
            }
        }
        if (options.role) {
            config.lambda.sharedRole = true
        }
        if (lambdaMetadata.api) {
            config.api = lambdaMetadata.api 
        }
        if (s3Key) {
            config.s3key = s3Key
        }
        return config
    }

    // 加载用户角色
    const loadRole = function (functionName) {
        logger.logStage(`initialising IAM role`)
        if (options.role) {
            if (judgeRole.isRoleArn(options.role)) {
                return Promise.resolve({
                    Role: {
                        RoleName: options.role,
                        Arn: options.role
                    }
                })
            }
            return iam.getRole({RoleName: options.role}).promise()
        } else {
            return iam.createRole({
                RoleName: functionName + '-executor',
                AssumeRolePolicyDocument: lambdaExecutorPolicy()
            }).promise()
        }
    }

    // 添加额外policy文件
    const addExtraPolicies = function () {
        return Promise.all(policyFiles().map(fileName => {
            const policyName = path.basename(fileName).replace(/[^A-z0-9]/g, '-')
            return addPolicy(iam, policyName, roleMetadata.Role.RoleName, fileName)
        }))
    }

    // 
    const cleanup = function (result) {
        if (!options.keep) {
            fsUtils.rmDir(workingDir) 
            fs.unlinkSync(packageArchive)
        } else {
            result.archive = packageArchive
        }
        return result
    }

    if (validationError()) {
        return Promise.reject(validationError())
    }

    return initEnvVarsFromOptions(options)
        .then(opts => customEnvVars = opts)
        .then(getPackageInfo)
        .then(packageInfo => {
            functionName = packageInfo.name
            functionDesc = packageInfo.description
        })
        .then(() => getOwnerInfo(options.region, logger))
        .then(ownerInfo => {
            ownerAccount = ownerInfo.account 
            awsPartition = ownerInfo.partition 
        })
        .then(() => fsPromise.mkdtemp(os.tmpdir() + path.sep))
        .then(dir => workingDir = dir)
        .then(() => collectFiles(source, workingDir, options, logger))
        .then(dir => {
            logger.logStage('validating package')
            return validatePackage(dir, options.handler, options['api-module'])
        })
        .then(dir => {
            packageFileDir = dir
            return cleanUpPackage(dir, options, logger)
        })
        .then(dir => {
            logger.logStage('zipping package')
            return zipdir(dir)
        })
        .then(zipFile => {
            packageArchive = zipFile
        })
        .then(() => loadRole(functionName))
        .then((result) => {
            roleMetadata = result
        })
        .then(() => {
            if (!options.role) {
                return iam.putRolePolicy({
                    RoleName: roleMetadata.Role.RoleName,
                    PolicyName: 'log-writer',
                    PolicyDocument: loggingPolicy(awsPartition)
                }).promise()
                .then(() => {
                    if (getSnsDLQTopic()) {
                        return iam.putRolePolicy({
                            RoleName: roleMetadata.Role.RoleName,
                            PolicyName: 'dlq-publisher',
                            PolicyDocument: snsPublishPolicy(getSnsDLQTopic())
                        }).promise()
                    }
                })
            }
        })
        .then(() => {
            if (options.policies) {
                return addExtraPolicies()
            }
        })
        .then(() => lambadCode(s3, packageArchive, options['use-s3-bucket'], options['s3-see'], options['s3-key']))
        .then(functionCode => {
            s3Key = functionCode.S3Key
            return createLambda(functionName, functionDesc, functionCode, roleMetadata.Role.Arn)
        })
        .then(markAliases)
        .then(lambdaMetadata => {
            if (options['api-module']) {
                return createWebApi(lambdaMetadata, packageFileDir)
            } else if (options['deploy-proxy-api']) {
                return deployProxyApi(lambdaMetadata, options, ownerAccount, awsPartition, apiGatewayPromise, logger)
            } else {
                return lambdaMetadata
            }
        })
        .then(saveConfig)
        .then(formatResult)
        .then(cleanup)
}

module.exports.doc = {
    description: '创建一个初始的Lambda函数和相关角色.',
	priority: 1,
	args: [
		{
			argument: 'region',
			description: '指定在哪个AWS区域创建 Lambda 函数. 更多信息，请查看\n https://docs.aws.amazon.com/general/latest/gr/rande.html#lambda_region',
			example: 'us-east-1'
		},
		{
			argument: 'handler',
			optional: true,
			description: '用于 Lambda 执行的函数, 如 module.function',
		},
		{
			argument: 'api-module',
			optional: true,
			description: 'The main module to use when creating Web APIs. \n' +
				'If you provide this parameter, do not set the handler option.\n' +
				'This should be a module created using the Claudia API Builder.',
			example: 'if the api is defined in web.js, this would be web'
		},
		{
			argument: 'deploy-proxy-api',
			optional: true,
			description: 'If specified, a proxy API will be created for the Lambda \n' +
				' function on API Gateway, and forward all requests to function. \n' +
				' This is an alternative way to create web APIs to --api-module.'
		},
		{
			argument: 'name',
			optional: true,
			description: '指定 lambda 函数名称',
			'default': 'the project name from package.json'
		},
		{
			argument: 'version',
			optional: true,
			description: '指定该版本函数的别名， 如 development/test',
			example: 'development'
		},
		{
			argument: 'source',
			optional: true,
			description: '指定项目路径',
			'default': 'current directory'
		},
		{
			argument: 'config',
			optional: true,
			description: '指定配置文件路径',
			'default': 'sln.json'
		},
		{
			argument: 'policies',
			optional: true,
			description: '为 IAM policy 指定额外的目录或文件\n',
			example: 'policies/*.json'
		},
		{
			argument: 'allow-recursion',
			optional: true,
			description: '允许函数递归调用'
		},
		{
			argument: 'role',
			optional: true,
			description: 'The name or ARN of an existing role to assign to the function. \n' +
				'If not supplied, Claudia will create a new role. Supply an ARN to create a function without any IAM access.',
			example: 'arn:aws:iam::123456789012:role/FileConverter'
		},
		{
			argument: 'runtime',
			optional: true,
			description: '指定Nodejs运行环境版本， 更多信息，查看官网\n http://docs.aws.amazon.com/lambda/latest/dg/API_CreateFunction.html',
			default: 'nodejs12.x'
		},
		{
			argument: 'description',
			optional: true,
			description: '设置该函数的描述介绍信息',
			default: 'the project description from package.json'
		},
		{
			argument: 'memory',
			optional: true,
			description: '指定你的Lambda函数运行拥有的内存总量（M）.\n这个值必须是64Mb的整数倍.',
			default: 128
		},
		{
			argument: 'timeout',
			optional: true,
			description: '函数执行时间（s），超过时间将停止执行',
			default: 3
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
			argument: 'aws-delay',
			optional: true,
			example: '3000',
			description: '设置等待重新尝试操作，间隔的毫秒数',
			default: '5000'
		},
		{
			argument: 'aws-retries',
			optional: true,
			example: '15',
			description: '设置连接AWS操作失败，重试的次数',
			default: '15'
		},
		{
			argument: 'set-env',
			optional: true,
			example: 'S3BUCKET=testbucket,SNSQUEUE=testqueue',
			description: '以 Key=Vlaue 的形式设置环境变量'
		},
		{
			argument: 'set-env-from-json',
			optional: true,
			example: 'production-env.json',
			description: '将指定JSON文件中的参数设置到环境变量中'
		}
	]
}

/**
 * 未处理
 * 
 * apiGatewayPromise函数
 * 
 * rebuildWebApi 函数实现 Done
 */

/**
 * 备注：
 * 
 * 1. 删除了处理参数 security-group-ids 和 allow-recursion 的相关代码
 */