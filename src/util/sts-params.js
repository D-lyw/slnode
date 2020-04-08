/**
 * 
 */

const readline = require('readline')


function queryQuestion (question) {
	return new Promise((resolve, reject) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout
		})
		rl.question(question, (answer) => {
			if(answer) {
				resolve(answer)
			} else {
				reject(`You must answer the question!\n`)
			}
			rl.close()
		})
	})
}

module.exports = function stsParams(commandArgs) {
	if (!commandArgs) {
		return false;
	}
	if (!commandArgs['sts-role-arn'] && !commandArgs['mfa-serial']) {
		return false;
	}

	const result = { params: {} },
		askForToken = (serial, callback) => {
			queryQuestion(`Please enter the code for MFA device ${serial}:`)
			.then(result => callback(null, result))
			.catch(callback);
		},
		fixedToken = (serial, callback) => {
			callback(null, commandArgs['mfa-token']);
		};

	if (commandArgs['sts-role-arn']) {
		result.params.RoleArn = commandArgs['sts-role-arn'];
	}
	if (commandArgs['mfa-serial']) {
		result.params.SerialNumber = commandArgs['mfa-serial'];
		if (commandArgs['mfa-duration']) {
			result.params.DurationSeconds = commandArgs['mfa-duration'];
		}
		if (commandArgs['mfa-token']) {
			result.tokenCodeFn = fixedToken;
		} else {
			result.tokenCodeFn = askForToken;
		}
	}
	return result;
};
