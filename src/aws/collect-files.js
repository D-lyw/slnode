/**
 * 将项目文件转移到临时文件目录下
 */

const fsUtils = require('../util/fs-utils')
const fsPromise = require('fs').promises
const path = require('path')
const NullLogger = require('../util/null-logger')
const readJson = require('../util/read-json')
const runNpm = require('../util/run-npm')
const extractTar = require('../util/extract-tar')
const packProjectToTar = require('../util/pack-project-to-tar')

module.exports = function collectFiles(sourcePath, workingDir, options, optionalLogger) {
    const logger = optionalLogger || new NullLogger()
    const runQuietly = options && options.quiet
    const useLocalDependencies = options && options['use-local-dependencies']
    const npmOptions = (options && options['npm-options']) ? options['npm-options'].split(' ') : []

    const checkPreconditions = function (providedSourcePath) {
        if (!providedSourcePath) {
            return '未提供项目路径'
        }
        if (!fsUtils.fileExists(providedSourcePath)) {
            return '提供的项目路径不存在'
        }
        if (!fsUtils.isDir(providedSourcePath)) {
            return '提供的路径必须是一个目录'
        }
        if (!workingDir) {
            return '工作目录未提供'
        }
        if (!fsUtils.fileExists(workingDir)) {
            return '提供的工作目录不存在'
        }
        if (!fsUtils.isDir(workingDir)) {
            return '工作路径必须为一个目录'
        }
        if (!fsUtils.fileExists(path.join(providedSourcePath, 'package.json'))) {
            return '提供的项目路径下未找到　package.json　文件'
        }
    }

    const copyIfExists = function (targetDir, referencedir, fileNames) {
        fileNames.forEach(fileName => {
            const filePath = path.join(referencedir, fileName)
            if (fsUtils.fileExists(filePath)) {
                fsUtils.copy(filePath, targetDir)
            }
        })
        return targetDir
    }
    const cleanCopyToDir = function (projectDir) {
        return packProjectToTar(projectDir, workingDir, npmOptions, logger)
            .then(archive => extractTar(archive, path.dirname(archive)))
            .then(archiveDir => path.join(archiveDir, 'package'))
            .then(dir => copyIfExists(dir, projectDir, ['.npmrc', 'package-lock.json']))
    }
    const installDependencies = function (targetDir) {
        if (useLocalDependencies) {
            fsUtils.copy(path.join(sourcePath, 'node_modules'), targetDir)
            return Promise.resolve(targetDir)
        } else {
            return runNpm(targetDir, ['install', '-q', '--no-audit', '--production'].concat(npmOptions), logger, runQuietly)
        }
    }
    const isRelativeDependency = function (dependency) {
        return (dependency && typeof dependency === 'string' && (dependency.startsWith('file:')
            || dependency.startsWith('.') || dependency.startsWith('/')));
    }
    const hasRelativeDependencies = function (packageConf) {
        return ['dependencies', 'devDependencies', 'optionalDependencies'].find(depType => {
            const subConf = packageConf[depType];
            return subConf && Object.keys(subConf).map(key => subConf[key]).find(isRelativeDependency);
        });
    }

    const activeRemapPromise = {}

    const remapSingleDep = function (dependencyPath, referencePath)　{
        if (!isRelativeDependency(dependencyPath)) {
            throw new Error(`不合法的路径　${dependencyPath}`)
        }
        const actualPath = path.resolve(referencePath, dependencyPath.replace(/^file:/, ''))
        if (fsUtils.isFile(actualPath)) {
            return Promise.resolve('file:' + actualPath)
        }
        if (fsUtils.isDir(actualPath)) {
            if (!activeRemapPromise[actualPath]) {
                activeRemapPromise[actualPath] = readJson(path.join(actualPath, 'package.json'))
                .then(packageConf => {
                    if (!hasRelativeDependencies(packageConf)) {
                        return packProjectToTar(actualPath, workingDir, npmOptions, logger)
                    }
                    return cleanCopyToDir(actualPath)
                        .then(cleanCopyPath => rewireRelativeDependencies(cleanCopyPath, actualPath))
                        .then(cleanCopyPath => packProjectToTar(cleanCopyPath, workingDir, npmOptions, logger))
                })
                .then(remappedPath => 'file:' + remappedPath)
            }
            return activeRemapPromise[actualPath]
        }
        throw new Error(`${dependencyPath} 指向的　${actualPath} 路径错误`)
    }

    const remapDependencyType = function (subConfig, referenceDir) {
        if (!subConfig) {
            return false
        }
        const keys = Object.keys(subConfig)
        const relativeDeps = keys.filter(key => isRelativeDependency(subConfig[key]))
        if (!relativeDeps.length) {
            return false
        }
        return Promise.all(relativeDeps.map(key => remapSingleDep(subConfig[key], referenceDir)))
            .then(results => results.forEach((val, index) => subConfig[relativeDeps[index]] = val))
            .then(() => true)
    }

    const rewireRelativeDependencies = function (targetDir, referenceDir) {
        const confPath = path.join(targetDir, 'package.json')
        return readJson(confPath)
            .then(packageConfig => {
                if (hasRelativeDependencies(packageConfig)) {
                    if (packageConfig.devDependencies) {
                        delete packageConfig.devDependencies
                    }
                    return Promise.all(['dependencies', 'optionalDependencies'].map(t => remapDependencyType(packageConfig[t], referenceDir)))
                        .then(() => fsPromise.writeFile(confPath, JSON.stringify(packageConfig, null, 2), 'utf8'))
                        .then(() => fsUtils.silentRemove(path.join(targetDir, 'package.json')))
                }
            })
            .then(() => targetDir)
    }

    const validationError = checkPreconditions(sourcePath)
    logger.logStage('packaging files')
    if (validationError) {
        return Promise.reject(validationError)
    }

    return cleanCopyToDir(sourcePath)
        .then(copyDir => rewireRelativeDependencies(copyDir, sourcePath))
        .then(installDependencies)
}