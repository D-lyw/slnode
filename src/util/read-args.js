/**
 * read command line args 
 * used in serverless-node.js
 */

const minimist = require('minimist')

module.exports = function () {
    return minimist(process.argv.slice(2), {
        alias: { h: 'help', v: 'version' },
        string: ['source', 'name', 'region', 'profile', 'mfa-serial','mfa-token'],
        boolean: ['quiet', 'force'],
        default: {
            'source': process.cwd(),
            'mfa-serial': process.env.AWS_MFA_SERIAL,
            'mfa-duration': (process.env.AWS_MFA_DURATION || 3600),
            'sts-role-arn': process.env.AWS_ROLE_ARN
        }
    })
}