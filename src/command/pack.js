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
            logger.logStage('压缩包')
            return zipdir(dir)
        })
        .then(zipFile => fsUtil.move(zipFile, outputFileName))
        .then(cleanup)
        .then(() => ({
            output: outputFileName
        }))
}

module.exports.doc = {
	description: 'Package a zip file for uploading to Lambda with all the required NPM dependencies, without deploying it anywhere.\nWorks with any JavaScript Lambda project, not just Claudia-related deployments.',
	priority: 4,
	args: [
		{
			argument: 'output',
			optional: true,
			description: 'Output file path',
			default: 'File in the current directory named after the NPM package name and version'
		},
		{
			argument: 'force',
			optional: true,
			description: 'If set, existing output files will be overwritten',
			default: 'not set, so trying to write over an existing output file will result in an error'
		},
		{
			argument: 'source',
			optional: true,
			description: 'Directory with project files',
			'default': 'current directory'
		},
		{
			argument: 'no-optional-dependencies',
			optional: true,
			description: 'Do not pack optional dependencies.'
		},
		{
			argument: 'use-local-dependencies',
			optional: true,
			description: 'Do not install dependencies, use the local node_modules directory instead'
		},
		{
			argument: 'npm-options',
			optional: true,
			description: 'Any additional options to pass on to NPM when installing packages. Check https://docs.npmjs.com/cli/install for more information',
			example: '--ignore-scripts',
			since: '5.0.0'
		},
		{
			argument: 'post-package-script',
			optional: true,
			example: 'customNpmScript',
			description: 'the name of a NPM script to execute custom processing after claudia finished packaging your files.\n' +
				'Note that development dependencies are not available at this point, but you can use npm uninstall to remove utility tools as part of this step.',
			since: '5.0.0'
		}
	]
}