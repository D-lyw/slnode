/**
 * sns 发布相关信息 
 */

module.exports = function snsPublishPolicy (arn) {
    return JSON.stringify({
        'Version': '2012-10-17',
        'Statement': [
			{
				'Effect': 'Allow',
				'Action': [
					'sns:Publish'
				],
				'Resource': [
					arn
				]
			}
		]
    })
}