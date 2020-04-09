const path = require('path')
const fsUtil = require('../util/fs-utils')
const fsPromise = require('fs').promises
const runNpm = require('../util/run-npm')

module.exports = function cleanUpPackage(packgageDir, options, logger) {
    const npmOptions = (options && options['npm-options']) ? options['npm-options'].split(' ') : []
    const dedupe = function () {
        return runNpm(packgageDir, ['dedupe', '-q', '--no-package-loc'].concat(npmOptions), logger, true)
    }
    const runPostPackageScript = function () {
        const script = options['post-package-script']
        if (script) {
            return runNpm(packgageDir, ['run', script].concat(npmOptions), logger, options && options.quiet)
        }
    }
    const fixEntryPermissions = function (path) {
        return fsPromise.stat(path)
            .then(stats => {
                const requiredMode = stats.isDirectory() ? 0o755 : 0o644
                return (stats.mode & 0o777) | requiredMode
            })
            .then(mode => fsPromise.chmod(path, mode))
    }
    const fixFilePermissions = function () {
        return Promise.all(
            fsUtil.recursiveList(packgageDir)
            .map(component => fixEntryPermissions(path.join(packgageDir, component)))
        )
    }
    const cleanUpDependencies = function () {
        if (options['optional-dependencies'] === false) {
            logger.logApiCall('removing optional dependencies')
            fsUtil.rmDir(path.join(packgageDir, 'node_modules'))
            return runNpm(packgageDir, ['install', '-q', '--no-package-lock', '--no-audit', '--production', '--no-optional'].concat(npmOptions), logger, options && options.quiet)
        }
    }

    return Promise.resolve()
        .then(() => fsUtil.silentRemove(path.join(packgageDir, 'package-lock.json')))
        .then(cleanUpDependencies)
        .then(dedupe)
        .then(runPostPackageScript)
        .then(() => fsUtil.silentRemove(path.join(packgageDir, '.npmrc')))
        .then(fixFilePermissions)
        .then(() => packgageDir)
}