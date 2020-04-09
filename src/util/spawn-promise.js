
const cp = require('child_process')
const os = require('os')

module.exports = function spawnPromise(command, args, options, suppresOutput) {
    const isWin = os.platform() === 'win32'
    const actualCommand = isWin ? `"${command}` : command
    const normalDefaults = {env: process.env, cwd: process.cwd()}
    const windowDefaults = Object.assign({shell: true}, normalDefaults)
    const defaultOptions = isWin ? windowDefaults : normalDefaults

    if (isWin) {
        args.forEach((v, i) => {
            if (/\s/.test(v)) {
                args[i] = `"${v}"`
            }
        })
    }

    return new Promise((resolve, reject) => {
        const subProcess = cp.spawn(actualCommand, args, Object.assign(defaultOptions, options))
        if (!suppresOutput) {
            subProcess.stdout.pipe(process.stdout)
        }
        subProcess.stderr.pipe(process.stderr)
        subProcess.on('close', (code) => {
            if (code > 0) {
                return reject(code)
            }
            resolve()
        })
        subProcess.on('error', reject)
    })
}