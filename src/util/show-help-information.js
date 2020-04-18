/**
 * 设置输出帮助提示信息 排版样式
 */

module.exports.commandHelp = function (command) {
    const result = []
    // 设置缩进
    const indent = function (str, indent) {
        const res = []
        const indentWidth = new Array(indent + 1).join(' ')
        if (Array.isArray(str)) {
            str.forEach(line => res.push(indentWidth + line.trim()))
        } else {
            res.push(indentWidth + str)
        }
        return res
    }
    const pushLines = function (arr) {
        arr.forEach(line => result.push(line))
    }

    result.push(`\nUsage： slnode ${command.command} {Options}`)
    result.push('')
    pushLines(indent(command.doc.description, 2))
    result.push('')
    result.push('Options are:')
    result.push('')
    command.doc.args.forEach(helpInfo => {
        const components = []
        const descLines = helpInfo.description.split('\n')

        components.push('  --' + helpInfo.argument)
        if (helpInfo.argument.length < 12) {
            components.push(new Array(12 - helpInfo.argument.length).join(' '))
        }
        if (helpInfo.optional) {
            components.push('[Optional]')
        }
        components.push(descLines.shift())
        result.push(components.join(' '))
        if (descLines.length) {
            pushLines(indent(descLines, 19))
        }
        if (helpInfo.example) {
            pushLines(indent('Examples: ' + helpInfo.example, 19))
        }
        if (helpInfo.default) {
            pushLines(indent('Defaults: ' + helpInfo.default, 19))
        }
    })
    result.push('')
    return result.join('\n')
}

module.exports.index = function (commands) {
    const result = []
    result.push(`\n  Usage: slnode [command] {Options}\n`)
    result.push(`  一个用于创建、部署和管理AWS Lambda和API网关服务的Serverless工具集.\n`)
    result.push(`Commands are:\n`)
    
    Object.keys(commands)
        .map(key => commands[key])
        .sort((cmd1, cmd2) => cmd1.doc.priority - cmd2.doc.priority)
        .forEach(command => {
            const components = []
            const descLines = command.doc.description.split('\n')
            components.push(' ')
            components.push(command.command)
            if (command.command.length < 20) {
                components.push(new Array(20 - command.command.length).join(' '))
            }
            components.push(descLines.shift())
            result.push(components.join(' '))
        })
    
    result.push('')
    result.push('Options are:\n')
    result.push('  --help               在屏幕上打印帮助信息')
    result.push('  --version            在屏幕上打印当前工具集版本信息')
    result.push('  --profile            设置AWS Lambda的凭证资料')
    result.push('  --proxy              设置AWS相关命令的Http代理')
    result.push('  --client-timeout     设置AWS SDK客户端网络重连等待的毫秒数，默认两分钟')
    result.push('')
    result.push('')
    result.push('Welcome to use it!\n')
    return result.join('\n')
}