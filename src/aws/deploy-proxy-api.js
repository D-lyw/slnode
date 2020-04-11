/**
 * 部署代理API
 */


const rebuildWebApi = require('./rebuild-web-api')
const apiGWurl = require('../util/api-url')

module.exports = function deployProxyApi (lambdaMetadata, options, ownerAccount, awsPartition, apiGatewayPromise, logger) {
    const apiConfig = {
        version: 3, 
        corsHandlers: true,
        routes: {
            '{proxy+}': {ANY: {}},
            '': { ANY: {}}
        },
        binaryMediaTypes: typeof options['binary-media-types'] === 'string'
				?	options['binary-media-types'].split(',').filter(a => a) : ['*/*']
    }
    const alias = options.version || 'latest'

    logger.logStage('creating REST API')

    return apiGatewayPromise.createRestApiPromise({
        name: lambdaMetadata.FunctionName
    })
    .then(result => {
        lambdaMetadata.api = {
            id: result.id,
            url: apiGWurl(result.id, options.region, alias)
        }
        return rebuildWebApi(lambdaMetadata.FunctionName, alias, result.id, apiConfig, ownerAccount, awsPartition, options.region, logger, options['cache-api-config'])
    })
    .then(() => lambdaMetadata)
}