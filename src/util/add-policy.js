const fsPromise = require('fs').promises

module.exports = function addPolicy(iam, policyName, roleName, fileName) {
    return fsPromise.readFile(fileName, 'utf8')
        .then(policyContent => iam.putRolePolicy({
            RoleName: roleName,
            PolicyName: policyName,
            PolicyDocument: policyContent
        }).promise())
}