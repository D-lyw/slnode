
module.exports.isRoleArn = function (string) {
    return /^arn:aws[^:]*:iam:.*:role\/[^:]+$/.test(string);
}

module.exports.isSNSArn = function (string) {
    return /^arn:aws[^:]*:sns:[^:]+:[^:]+:[^:]+$/.test(string);
}

module.exports.isSQSArn = function (string) {
    return /^arn:aws[^:]*:sqs:[^:]+:[^:]+:[^:]+$/.test(string);
}