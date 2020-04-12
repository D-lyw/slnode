/**
 * 销毁角色
 */

module.exports = function destroyRole(iam, roleName) {
    const deleteSinglePolicy = function (policyName) {
        return iam.deleteRolePolicy({
            PolicyName: policyName,
            RoleName: roleName 
        }).promise()
    }
    const detachSinglePolicy = function (policy) {
        return iam.detachRolePolicy({
            PolicyArn: policy.PolicyArn,
            RoleName: roleName
        }).promise()
    }

    return iam.listRolePolicies({RoleName: roleName}).promise()
        .then(result => Promise.all(result.PolicyNames.map(deleteSinglePolicy)))
        .then(() => iam.listAttachedRolePolicies({RoleName: roleName}).promise())
        .then(result => Promise.all(result.AttachedPolicies.map(detachSinglePolicy)))
        .then(() => iam.deleteRole({RoleName: roleName}).promise())
}