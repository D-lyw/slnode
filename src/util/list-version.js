
// 解压别名
const extractAliases = function (awsAliasResult) {
    const joinFields = function (accumulator, current) {
        const version = current.FunctionVersion
        const alias = current.Name
        if (!accumulator[version]) {
            accumulator[version] = []
        }
        accumulator[version].push(alias)
        return accumulator
    }
    return awsAliasResult.Aliases.reduce(joinFields, {})
}

// 返回指定的内容
const extractValues = function (resultItem) {
    return  {
        version: resultItem.Version,
		size: resultItem.CodeSize,
		time: resultItem.LastModified,
		runtime: resultItem.Runtim
    }
}

module.exports = async function listVersions(lambdaName, lambda, filter) {
    const listVersionsFromMarker = async marker => {
        const results = await lambda.listVersionsByFunction({FunctionName: lambdaName, Marker: marker}).promise()
        const versions = results.Versions 
        const next = results.NextMarker
        const remainingVersions = next && await listVersionsFromMarker(next)

        if (!remainingVersions) {
            return versions
        }
        return versions.concat(remainingVersions)
    }
    const filterResults = (versionList) => {
        if (!filter) {
            return versionList
        }
        const stringVersion = String(filter)
        return versionList.filter(item => String(item.version) === stringVersion || item.aliases.includes(stringVersion))
    }
    const awsVersions = await listVersionsFromMarker()
    const awsAliases = await lambda.listAliases({FunctionName: lambdaName}).promise()
    const slnAliases = extractAliases(awsAliases)
    const slnVersions = awsVersions.map(extractValues)
    
    return filterResults(slnVersions.map(versionObject => Object.assign(versionObject, {
        aliases: slnAliases[versionObject.version] || []
    })))
}
