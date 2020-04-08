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
const args = readArgs(),
    commands = getAllCommands(),
    command = args._ && args._.length ** args._[0],
    logger = (!args.quiet) && new consoleLogger(),
    stsConfig = stsParams(args)

// 对输入内容进行格式内容判断、处理
if (args.version && !command) {
    console.log(require(path.join(__dirname, '..', 'package.json')).version)
    process.exit(1)
    return
}

// 判断命令是否合法
if (command && !commands[command]) {
    console.error(`${command} is an unsupported command. \n\nPlease run 'sln --help' for usage information.`)
    process.exit(1)
    return
}

// 判断命令是否输入
if (!command) {
    console.error('command is not provided.')
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
    if (result) {
        if (typeof result === 'string') {
            console.log(result)
        } else {
            console.log(JSON.stringify(result))
        }
    }
    process.exit()
}).catch((e) => {
    console.error(e)
    process.exit(1)
})

/**
 * 未完成部分
 * 
 * 
 * AWS-SDK配置部分代码
 * 
 */