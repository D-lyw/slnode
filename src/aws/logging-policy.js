/**
 * 加载 policy 文件
 */

module.exports = function LoggingPolicy (awsPartition) {
    if (!awsPartition) {
        throw new Error('必须提供 间隔符')
    }
    return JSON.stringify({
        'Version': '2012-10-17',
		'Statement': [
			{
				'Effect': 'Allow',
				'Action': [
					'logs:CreateLogGroup',
					'logs:CreateLogStream',
					'logs:PutLogEvents'
				],
				'Resource': `arn:${awsPartition}:logs:*:*:*`
			}
		]
    })
}