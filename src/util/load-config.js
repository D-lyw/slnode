/**
 * 加载项目中的配置文件
 */

const path = require('path')
const fsUtils = require('../util/fs-utils')
const readjson = require('../util/read-json')
const judgeRole = require('../util/judge-role')

const getSourceDir = function (options) {
    if (typeof options === 'string') {
        return options
    } else if (options && options.source) {
        return options.source
    } else {
        return process.cwd()
    }
}

const configMissingError = function (options) {
    if (options && options.config) {
        return `${options.config} 不存在`
    }
    return 'sln.json文件不存在项目根目录下'
}

const toRoleName = function (roleNameOrArn) {
    if (judgeRole.isRoleArn(roleNameOrArn)) {
        return roleNameOrArn.replace(/.*\//, '')
    }
    return roleNameOrArn
}

module.exports = function loadConfig (options, validate) {
    const fileName = (options && options.config) || path.join(getSourceDir(options), 'sln.json')
    validate = validate || {}

    if (!fsUtils.fileExists(fileName)) {
        return Promise.reject(configMissingError(options))
    }
    return readjson(fileName)
        .then(config => {
            const name = config && config.lambda && config.lambda.name
			const region = config && config.lambda && config.lambda.region
            const role = config && config.lambda && config.lambda.role
            if (role) {
                config.lambda.role = judgeRole.isRoleArn(role)
            }
            if (validate.lambda && validate.lambda.name && !name) {
                return Promise.reject(`sln.json 文件中未配置name值`)
            }
            if (validate.lambda && validate.lambda.region && !region) {
                return Promise.reject('sln.json 文件中未配置region值')
            }
            if (validate.lambda && validate.lambda.role && !role) {
                return Promise.reject('sln.json文件中未配置role值')
            }
            return config
        })
}
