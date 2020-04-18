/**
 * 打包项目文件
 */

const path = require('path')
const fsUtil = require('../util/fs-utils')
const fsPromise = require('fs').promises
const os = require('os')
const zipdir = require('../util/zipdir')
const readJson = require('../util/read-json')
const collectFiles = require('../aws/collect-files')
const cleanUpPackage = require('../util/cleanUpPackage')
const NullLogger = require('../util/null-logger')
const expectedArchiveName = require('../util/expected-archive-name')

module.exports = function pack (options, optionalLogger) {
    let workingDir, outputFileName = options.output && path.resolve(options.output)
    const logger = optionalLogger || new NullLogger()
    const source = (options && options.source) || process.cwd()
    const packageConfPath = path.join(source, 'package.json')

    const validationError = function () {
        if (source === os.tmpdir()) {
            return '项目目录不能为nodejs的临时目录'
        }
        if (options['optional-dependencies'] === false && options['use-local-dependencies']) {
            return `--use-local-dependencies 和 --no-optional-dependencies 不能同时设置`
        }
        if (!fsUtil.fileExists(packageConfPath)) {
            return `项目根目录下不存在 package.json 文件`
        }
    }
    const cleanup = function (result) {
        fsUtil.rmDir(workingDir)
        return result
    }
    if (validationError()) {
        return Promise.reject(validationError())
    }
    return fsPromise.mkdtemp(os.tmpdir() + path.sep)
        .then(dir => workingDir = dir)
        .then(() => {
            if (!outputFileName) {
                return readJson(packageConfPath)
                    .then(packageConf => outputFileName = path.resolve(expectedArchiveName(packageConf, '.zip')))
            }
        })
        .then(() => {
            if (!options.force && fsUtil.fileExists(outputFileName)) {
                throw `${outputFileName} 已经存在，使用 --force 强制覆盖`
            }
        })
        .then(() => collectFiles(source, workingDir, options, logger))
        .then(dir => cleanUpPackage(dir, options, logger))
        .then(dir => {
            logger.logStage('压缩项目文件')
            return zipdir(dir)
        })
        .then(zipFile => fsUtil.move(zipFile, outputFileName))
        .then(cleanup)
        .then(() => ({
            output: outputFileName
        }))
}

module.exports.doc = {
	description: '将Lambda函数及其NPM依赖打包成一个zip文件，而不进行部署.',
	priority: 4,
	args: [
		{
			argument: 'output',
			optional: true,
			description: '输出文件路径',
			default: '当前目录'
		},
		{
			argument: 'force',
			optional: true,
			description: '强制覆盖已存在的同名文件',
		},
		{
			argument: 'source',
			optional: true,
			description: '项目文件路径',
			'default': 'current directory'
		},
		{
			argument: 'no-optional-dependencies',
			optional: true,
			description: '不打包可选的依赖.'
		},
		{
			argument: 'use-local-dependencies',
			optional: true,
			description: '不安装依赖，使用本地的node_modules中的依赖'
		},
	]
}