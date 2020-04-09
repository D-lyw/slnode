/**
 * 返回AWS Lambda的URL链接
 */

module.exports = function apiGWUrl(apiId, region, stage) {
    return `https://${apiId}.execute-api.${region}.amazonaws.com/${stage}`  
}