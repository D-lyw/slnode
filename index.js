
const fs = require('fs')
const path = require('path')

const getCommands = function () {
    const result = {}
    fs.readFileSync(path.join(__dirname, './src/command')).forEach(fileName => {
        const cmdName = path.basename(fileName, '.js')
        const cmdFun = require(`./src/command/${cmdName}`)
        result[cmdFun.name] = cmdFun
    })
    return result
}

module.exports = getCommands()