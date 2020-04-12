/**
 * 展示已经发布的函数版本
 */

const aws = require('aws-sdk')
const loadConfig = require('../util/load-config')
const listVersions = require('../util/list-version')

module.exports = async function list(options) {
    const header = ['#\ttime                        \tsize\truntime\taliases']
    const formatters = {
        json: {
            item: i => i,
            array: a => a
        },
        text: {
            item: i => `${i.version}\t${i.time}\t${i.size}\t${i.runtime}\t${i.aliases.join(', ')}`,
            array: a => header.concat(a).join('\n')
        }
    }
    const formatter = formatters[options.format || 'text']
    const formatResult = function (versionList) {
        return formatter.array(
            versionList.map(formatter.item)
        )
    }
    const config = await loadConfig(options, {lambda: {name: true, region: true}})
    const lambda = new aws.Lambda({region: config.lambda.region})
    const versionList = await listVersions(config.lambda.name, lambda, options.version)

    if (!formatter) {
        throw `格式错误 ${options.format}`
    }
    return formatResult(versionList)
}

module.exports.doc = {
	description: 'List published versions of a function',
	priority: 3,
	args: [
		{
			argument: 'version',
			optional: true,
			description: 'show only the specified version or alias',
			example: 'production'
		},
		{
			argument: 'format',
			optional: true,
			example: 'json',
			description: 'result format. valid options are json and text',
			default: 'text'
		},
		{
			argument: 'source',
			optional: true,
			description: 'Directory with project files',
			default: 'current directory'
		},
		{
			argument: 'config',
			optional: true,
			description: 'Config file containing the resource names',
			default: 'claudia.json'
		}
	]
}