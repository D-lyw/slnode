/**
 * 获取所有的命令实现函数并导出
 */
const path = require('path')
const fs = require('fs')

module.exports = function getAllCommands () {
    const commands = {}
    fs.readdirSync(path.join(__dirname, '../', 'command')).forEach((fileName) => {
        const cmdName = path.basename(fileName, '.js')
        commands[cmdName] = require(`../command/${cmdName}`)
        commands[cmdName].command = cmdName
    })
    return commands
}