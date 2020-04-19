#! /usr/bin/env node
const path = require('path')
const getAllCommands = require('../src/util/get-all-commands')
const readArgs = require('../src/util/read-args')
const consoleLogger = require('../src/util/console-logger')
const stsParams = require('../src/util/sts-params')
const helpInformation = require('../src/util/show-help-information')
const HttpsProxyAgent = require('https-proxy-agent')

const AWS = require('aws-sdk')


// 获取命令行参数和命令
const args = readArgs()
const commands = getAllCommands()
const command = args._ && args._.length && args._[0]
const logger = (!args.quiet) && new consoleLogger()
const stsConfig = stsParams(args)

// 对输入内容进行格式内容判断、处理
if (args.version && !command) {
    console.log(require(path.join(__dirname, '..', 'package.json')).version)
    process.exit(1)
    return
}

// 判断命令是否合法
if (command && !commands[command]) {
    console.error(` ${command} 是一个不被支持的命令. \n\n请运行 slnode --help 获取更多使用信息.\n`)
    process.exit(1)
    return
}

// 显示对应命令的帮助信息
if (args.help) {
    if (command) {
        console.log(helpInformation.commandHelp(commands[command]))
    } else {
        console.log(helpInformation.index(commands))
    }
    return;
}

// 判断命令是否输入
if (!command) {
    console.error('请输入指定的操作命令，更多信息请执行 slnode --help\n')
    process.exit(1)
    return
}
// 与AWS Lambda相关的配置信息
if (args.profile) {
    AWS.config.credentials = new AWS.SharedIniFileCredentials({profile: args.profile})
}
if (args['client-timeout']) {
    AWS.config.httpOptions = AWS.config.httpOptions || {}
    AWS.config.httpOptions.timeout = args['aws-client-timeout']
}
if (args.proxy) {
    AWS.config.httpOptions = AWS.config.httpOptions || {}
    AWS.config.httpOptions.agent = new HttpsProxyAgent(args.proxy)
}

if (stsConfig) {
    AWS.config.credentials = new AWS.ChainableTemporaryCredentials(Object.assign(stsConfig, {masterCredentials: AWS.config.credentials}))
}



// 执行对应命令和输出相应信息
commands[command](args, logger).then(result => {
    if (result && !args.quiet) {
        console.log(result)
    }
    process.exit()
}).catch((e) => {
    console.error(e)
    process.exit(1)
})
