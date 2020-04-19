/**
 * 重新构建 web api
 */

const aws = require('aws-sdk')
const NullLoger = require('../util/null-logger')
const retriableWrap = require('../util/retriable-wrap')
const entityWrap = require('../util/entity-wrap')
const safeHash = require('../util/safe-hash')
const validAuthType = require('../util/valid-auth-type')
const validCredentials = require('../util/valid-credentials')
const flattenRequestParameters = require('../util/flatten-request-param')
const pathSplitter = require('../util/path-splitter')
const sequentialPromiseMap = require('sequential-promise-map')
const allowApiInvocation = require('../aws/allow-api-invocation')
const registerAuthorizers = require('../aws/register-authorizers')
const clearApi = require('../util/clear-api')

module.exports = function rebuildWebApi(functionName, functionVersion, restApiId, apiConfig, ownerAccount, awsPartition, awsRegion, optionalLogger, configCacheStageVar) {
    let authorizerIds
    const logger = optionalLogger || new NullLoger()
    const apiGateway = retriableWrap(
        entityWrap(
            new aws.APIGateway({region: awsRegion}),
            {log: logger.logApiCall, logName: 'apiagteway'}
        ),
        () => logger.logApiCall(`AWS 限制了速率，稍后再重试`)
    )
    const configHash = safeHash(apiConfig)
    const knownIds = {}
    const supportsCors = function () {
        return (apiConfig.corsHandlers !== false)
    }
    const supportsMockCorsIntegration = function () {
        return supportsCors && apiConfig.corsHandlers !== true
    }
    const putMockIntegration = function (resourceId, httpMethod) {
        return apiGateway.putIntegrationPromise({
            restApiId: restApiId,
            resourceId: resourceId,
            httpMethod: httpMethod,
            type: 'MOCK',
            requestTemplates: {
                'application/json': '{\"statusCode\": 200}'
            }
        })
    }
    const putLambdaIntegration = function (resourceId, methodName, credentials, cacheKeyParameters, integrationContentHandling) {
        return apiGateway.putIntegrationPromise({
            restApiId: restApiId,
            resourceId: resourceId,
            httpMethod: methodName,
            credentials: credentials,
            type: 'AWS_PROXY',
            cacheKeyParameters: cacheKeyParameters,
            integrationHttpMethod: 'POST',
            passthroughBehavior: 'WHEN_NO_MATCH',
            contentHandling: integrationContentHandling,
            uri: 'arn:' + awsPartition + ':apigateway:' + awsRegion + ':lambda:path/2015-03-31/functions/arn:' + awsPartition + ':lambda:' + awsRegion + ':' + ownerAccount + ':function:' + functionName + ':${stageVariables.lambdaVersion}/invocations'
        })
    }
    const corsHeaderValue = function () {
        if (apiConfig.corsHandlers === '') {
            return ''
        }
        if (!supportsCors()) {
            return ''
        }
        const val = apiConfig.corsHandlers || 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'
        return '\'' + val + '\''
    }

    const createMethod = function (methodName, resourceId, path) {
        const methodOptions = apiConfig.routes[path][methodName]
        const apiKeyRequired = function () {
            return methodOptions && methodOptions.apiKeyRequired
        }
        const authorizationScopes = function () {
            return methodOptions && methodOptions.authorizationScopes 
        }
        const authorizationType = function () {
            if (methodOptions && methodOptions.authorizationType && validAuthType(methodOptions.authorizationType.toUpperCase())) {
                return methodOptions.authorizationType.toUpperCase()
            } else if (methodOptions.customAuthorizer) {
                return 'CUSTOM'
            } else if (methodOptions.cognitoAuthorizer) {
                return 'COGNITO_USER_POOLS'
            } else if (methodOptions && validCredentials(methodOptions.invokeWithCredentials)) {
                return 'AWS_IAM'
            } else {
                return 'NONE'
            }
        }
        const credentials = function () {
            if (methodOptions && methodOptions.invokeWithCredentials) {
                if (methodOptions.invokeWithCredentials === true) {
                    return 'arn:' + awsPartition + ':iam::*:user/*'
                } else if (validCredentials(methodOptions.invokeWithCredentials)) {
                    return methodOptions.invokeWithCredentials
                }
            }
            return null 
        }
        const addMethodResponse = function () {
            return apiGateway.putMethodResponsePromise({
                restApiId: restApiId,
                resourceId: resourceId,
                httpMethod: methodName,
                statusCode: '200'
            })
            .then(() => apiGateway.putIntegrationResponsePromise({
                restApiId: restApiId,
                resourceId: resourceId,
                httpMethod: methodName,
                contentHandling: methodOptions && methodOptions.success && methodOptions.success.contentHandling,
                statusCode: '200'
            }))
        }
        const authorizedId = function () {
            const authorizerName = methodOptions.customAuthorizer || methodOptions.cognitoAuthorizer
            return methodOptions && authorizerName && authorizerIds[authorizerName]
        } 
        const parmaeters = flattenRequestParameters(methodOptions.requestParameters, path)
        return apiGateway.putMethodPromise({
            authorizationType: authorizationType(),
            authorizerId: authorizedId(),
            httpMethod: methodName,
            resourceId: resourceId,
            restApiId: restApiId,
            requestParameters: parmaeters,
            apiKeyRequired: apiKeyRequired(),
            authorizationScopes: authorizationScopes()
        })
        .then(() => putLambdaIntegration(resourceId, methodName, credentials(), parmaeters && Object.keys(parmaeters), methodOptions.requestContentHandling))
        .then(addMethodResponse)
    }

    const createCorsHandler = function (resourceId, supportedMethods) {
        return apiGateway.putMethodPromise({
            authorizationType: 'NONE',
            httpMethod: 'OPTIONS',
            resourceId: resourceId,
            restApiId: restApiId
        })
        .then(() => {
            if (supportsMockCorsIntegration()) {
                return putMockIntegration(resourceId, 'OPTIONS')
            } else {
                putLambdaIntegration(resourceId, 'OPTIONS')
            }
        })
        .then(() => {
            let responseParams = null
            if (supportsMockCorsIntegration()) {
                responseParams = {
                    'method.response.header.Access-Control-Allow-Headers': false,
				    'method.response.header.Access-Control-Allow-Methods': false,
					'method.response.header.Access-Control-Allow-Origin': false,
					'method.response.header.Access-Control-Allow-Credentials': false,
					'method.response.header.Access-Control-Max-Age': false
                }
            }
            return apiGateway.putMethodResponsePromise({
                restApiId: restApiId,
                resourceId: resourceId,
				httpMethod: 'OPTIONS',
				statusCode: '200',
				responseParameters: responseParams
            })
        })
        .then(() => {
            let responseParams = null
            if (supportsMockCorsIntegration()) {
                const corsDomain = (supportsMockCorsIntegration() && apiConfig.corsHandlers) || '*'
				const corsHeaders = corsHeaderValue();

                responseParams = {
                    'method.response.header.Access-Control-Allow-Methods': `'OPTIONS,${supportedMethods.sort().join(',')}'`,
                    'method.response.header.Access-Control-Allow-Origin': `'${corsDomain}'`,
                    'method.response.header.Access-Control-Allow-Credentials': '\'true\''
                };
                if (corsHeaders) {
                    responseParams['method.response.header.Access-Control-Allow-Headers'] = corsHeaders;
                }
                if (apiConfig.corsMaxAge) {
                    responseParams['method.response.header.Access-Control-Max-Age'] = '\'' + apiConfig.corsMaxAge + '\'';
                }
            }

            return apiGateway.putIntegrationResponsePromise({
                restApiId: restApiId,
                resourceId: resourceId,
                httpMethod: 'OPTIONS',
                statusCode: '200',
                responseParameters: responseParams
            })
        })
    }

    const findResourceByPath = function (path) {
        const pathComponents = pathSplitter(path)
        if (knownIds[path]) {
            return Promise.resolve(knownIds[path])
        } else {
            return findResourceByPath(pathComponents.parentPath)
                .then(parentId => apiGateway.createResourcePromise({
                    restApiId: restApiId,
                    parentId: parentId,
                    pathPart: pathComponents.pathPart
                }))
                .then(resource => {
                    knownIds[path] = resource.id 
                    return resource.id 
                })
        }
    }

    const configurePath = function (path) {
        let resourceId
        const supportedMethods = Object.keys(apiConfig.routes[path])
        const hasCustomCorsHandler = apiConfig.routes[path].OPTIONS 
        const createMethodMapper = function (methodName) {
            return createMethod(methodName, resourceId, path)
        }

        return findResourceByPath(path)
            .then(r =>  {
                resourceId = r 
            })
            .then(() => sequentialPromiseMap(supportedMethods, createMethodMapper))
            .then(() => {
                if (!supportsCors() || hasCustomCorsHandler) {
                    return
                }
                return createCorsHandler(resourceId, supportedMethods)
            })
    }

    const configureGatePesponse = function (responseType, responseConfig) {
        const params = {
            restApiId: restApiId,
            responseType: responseType
        }
        if (responseConfig.statusCode) {
            params.statusCode = String(responseConfig.statusCode)
        }
        if (responseConfig.responseParameters) {
            params.responseParameters = responseConfig.responseParameters
        }
        if (responseConfig.responseTemplates) {
            params.responseTemplates = responseConfig.responseTemplates
        }
        if (responseConfig.headers) {
            params.responseParameters = params.responseParameters || {}
            Object.keys(responseConfig.headers).forEach(header => {
                params.responseParameters[`gatewayresponse.header.${header}`] = `'${responseConfig.headers[header]}'`
            })
        }
        return apiGateway.putGatewayResponsePromise(params)
    }
    
    const removeExistingResponse = function () {
        return clearApi(apiGateway, restApiId, functionName)
    }

    const cacheRootId = function () {
        return apiGateway.getResourcesPromise({restApiId: restApiId, limit: 499})
            .then(resources => {
                resources.items.forEach(resource => {
                    const pathWithoutStartingSlash = resource.path.replace(/^\//, '')
                    knownIds[pathWithoutStartingSlash] = resource.id
                })
            })
    }

    const rebuildApi = function () {
        return allowApiInvocation(functionName, functionVersion, restApiId, ownerAccount, awsPartition, awsRegion)
            .then(() => cacheRootId())
            .then(() => sequentialPromiseMap(Object.keys(apiConfig.routes), configurePath))
            .then(() => {
                if (apiConfig.customResponses) {
                    return sequentialPromiseMap(Object.keys(apiConfig.customResponses), responseType => configureGatewayResponse(responseType, apiConfig.customResponses[responseType]))
                }
            })
    }

    const deployApi = function () {
        const stageVars = {
            lambdaVersion: functionVersion
        }
        if (configCacheStageVar) {
            stageVars[configCacheStageVar] = configHash
        }
        return apiGateway.createDeploymentPromise({
            restApiId: restApiId,
            stageName: functionVersion,
            variables: stageVars
        })
    }

    const configureAuthorizers = function () {
        if (apiConfig.authorizers && apiConfig.authorizers !== {}) {
            return registerAuthorizers(apiConfig.authorizers, restApiId, ownerAccount, awsPartition, awsRegion, functionVersion, logger)
                .then(result => {
                    authorizerIds = result
                })
        } else {
            authorizerIds = {}
        }
    }
    const uploadApiConfig = function() {
        return removeExistingResponse()
            .then(configureAuthorizers)
            .then(rebuildApi)
            .then(deployApi)
            .then(() => ({ cacheReused: false}))
    }
    const getExistingConfigHash = function () {
        if (!configCacheStageVar) {
            return Promise.resolve(false)
        }
        return apiGateway.getStagePromise({restApiId: restApiId, stageName: functionVersion})
            .then(stage => stage.variables && stage.variables[configCacheStageVar])
            .catch(() => false)
    }

    return getExistingConfigHash()
        .then(existingHash => {
            if (existingHash && existingHash === configHash) {
                logger.logStage('重用API缓存配置')
                return {cacheReused: true}
            } else {
                return uploadApiConfig()
            }
        })
}