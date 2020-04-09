
const path = require('path')
const runNpm = require('../util/run-npm')
const readjson = require('../util/read-json')
const fsPromise = require('fs').promises

const expectedArchiveName = function (packageConfig) {
    return packageConfig.name.replace(/^@/, '').replace(/\//, '-') + '-' + packageConfig.version + (extension || '.tgz');
}

module.exports = function packProjectToTar(projectDir, workingDir, npmOptions, logger) {
    const absolutePath = path.resolve(projectDir) 
    const runWithConfg = function (packageConfig) {
        return fsPromise.mkdtemp(path.join(workingDir, expectedArchiveName(packageConfig, '-')))
            .then(packDir => {
                return runNpm(packDir, ['pack', '-q', absolutePath].concat(npmOptions), logger, true) 
            })
            .then(packDir => {
                return path.join(packDir, expectedArchiveName(packageConfig))
            })
    }
    return readjson(path.join(projectDir, 'package.json'))
        .then(runWithConfg)
}