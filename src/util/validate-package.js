/**
 * 校验　package.json　文件
 */

const path = require('path')
const validAuthType = require('../util/valid-auth-type') 
const validCredentials = require('../util/valid-credentials')

const CURRENT_API_VERSION = 4


module.exports = function validatePackge(dir, functionHandler, restApiModule) {
    const handlerComponents = functionHandler && functionHandler.split('.')
    let apiModulePath = handlerComponents && handlerComponents[0]
    let handlerMethod = handlerComponents && handlerComponents[1]
    let apiModule, apiConfig
    if (restApiModule) {
        apiModulePath = restApiModule
        handlerMethod = 'proxyRouter'
    }
    try {
        apiModule = require(path.join(dir, apiModulePath))
    } catch (e) {
        console.error(e.stack || e)
        throw `在清除安装之后，无法加载　${apiModulePath}`
    }

    if (!apiModule[handlerMethod]) {
        if (restApiModule) {
            throw `${apiModulePath}.js 没有导出一个sln API 构造实例`
        } else {
            throw `${apiModulePath}.js 没有导出方法 ${handlerMethod}`
        }
    }
    if (restApiModule) {
        try {
            apiConfig = apiModule.apiConfig && apiModule.apiConfig()
        } catch (e) {
            throw `${apiModulePath}.js 没有配置任何api方法`
        }
        if (!apiConfig || !apiConfig.routes || !Object.keys(apiConfig.routes).length) {
			throw `${apiModulePath}.js 没有配置任何api方法`;
		}
		if (apiConfig.version < CURRENT_API_VERSION) {
			throw `${apiModulePath}.js 使用了一个不支持的API版本`;
		}
		if (apiConfig.version > CURRENT_API_VERSION) {
			throw `${apiModulePath}.js 需要一个更好版本的 sln 命令集`;
        }

        Object.keys(apiConfig.routes).forEach(route => {
            const routeConfig = apiConfig.routes[route]
            Object.keys(routeConfig).forEach(method => {
                const methodConfig = routeConfig[method]
                const routeMessage = apiModulePath + '.js' + method + '/' + route + ' '

                if (methodConfig.success && methodConfig.success.headers) {
                    if (Object.keys(methodConfig.success.headers).length === 0) {
                        throw routeMessage + `需要一个custom header`
                    }
                }
                if (methodConfig.error && methodConfig.error.headers) {
                    if (Object.keys(methodConfig.error.headers).length === 0) {
                        throw routeMessage + '需要一个custom header';
                    }
                    if (Array.isArray(methodConfig.error.headers)) {
                        throw routeMessage + '提供默认custom header';
                    }
                }
                if (methodConfig.customAuthorizer && (!apiConfig.authorizers || !apiConfig.authorizers[methodConfig.customAuthorizer])) {
                    throw routeMessage + '请求了一个未定义的用户授权' + methodConfig.customAuthorizer;
                }
                if (methodConfig.cognitoAuthorizer && (!apiConfig.authorizers || !apiConfig.authorizers[methodConfig.cognitoAuthorizer])) {
                    throw routeMessage + '请求了一个 Cognito User Pools 授权 ' + methodConfig.cognitoAuthorizer;
                }
                if (methodConfig.authorizationType && !validAuthType(methodConfig.authorizationType)) {
                    throw routeMessage + ' 授权类型 ' + methodConfig.authorizationType + ' 是不合法的';
                }
                if (methodConfig.authorizationType && methodConfig.authorizationType !== 'CUSTOM' && methodConfig.customAuthorizer) {
                    throw routeMessage + '授权类型 ' + methodConfig.authorizationType + ' 和用户授权冲突';
                }
                if (methodConfig.invokeWithCredentials && !validCredentials(methodConfig.invokeWithCredentials)) {
                    throw routeMessage + '凭证必须是ARN或者布尔类型';
                }
                if (methodConfig.authorizationType && methodConfig.authorizationType !== 'AWS_IAM' && methodConfig.invokeWithCredentials) {
                    throw routeMessage + '授权类型 ' + methodConfig.authorizationType + ' 和调用凭证冲突';
                }
                if (!methodConfig.cognitoAuthorizer && methodConfig.authorizationScopes) {
                    throw routeMessage + '授权者和授权区域冲突';
                }
                if (methodConfig.authorizationScopes && !Array.isArray(methodConfig.authorizationScopes)) {
                    throw routeMessage + "'authorizationScopes' 必须是一个数组格式";
                }
            })
        })
        if (apiConfig.authorizers) {
            Object.keys(apiConfig.authorizers).forEach(authorizerName => {
                const authorizer = apiConfig.authorizers[authorizerName]
                const authorizerMessage = apiModulePath + '.js authorizer' + authorizerName + ' '
                if (!authorizer.lambdaName && !authorizer.lambdaArn && !authorizer.providerARNs) {
                    throw authorizerMessage + '需要提供一个 lambdaName, lambdaArn 或者 providerARNs'
                }
                if (authorizer.lambdaName && authorizer.lambdaArn) {
                    throw authorizerMessage + 'lambdaName 和 lambdaArn 都已经被定义';
                }
                if (authorizer.lambdaVersion && (typeof authorizer.lambdaVersion !== 'boolean' && typeof authorizer.lambdaVersion !== 'string')) {
                    throw authorizerMessage + 'lambdaVersion 类型必须为string 或 true';
                }
                if (authorizer.lambdaVersion && authorizer.lambdaArn) {
                    throw authorizerMessage + '无法在当前Lambda版本下使用 LambdaArn';
                }
            })
        }
    }
    
    return dir
}