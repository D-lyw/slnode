/**
 * 获取压缩包的名字
 */

module.exports = function expectedArchiveName (packageConfig, extension){ 
    return packageConfig.name.replace(/^@/, '').replace(/\//, '-') + '-' + packageConfig.version + (extension || '.tgz')
}