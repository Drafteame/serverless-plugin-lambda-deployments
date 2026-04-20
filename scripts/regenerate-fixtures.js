'use strict'

const fs = require('fs')
const path = require('path')
const { getInstalledPathSync } = require('get-installed-path')
const ServerlessLambdaDeployments = require('../serverless-plugin-lambda-deployments')

const serverlessPath = getInstalledPathSync('serverless', { local: true })
const Serverless = require(`${serverlessPath}/lib/Serverless`)
const serverlessVersion = parseInt(require(`${serverlessPath}/package.json`).version)
const AwsProvider = serverlessVersion > 1
  ? require(`${serverlessPath}/lib/plugins/aws/provider`)
  : require(`${serverlessPath}/lib/plugins/aws/provider/awsProvider`)

const fixturesPath = path.resolve(__dirname, '../fixtures')
const stage = 'dev'
const options = { stage }

const files = fs.readdirSync(fixturesPath)
const inputFiles = files.filter(f => f.includes('.input'))

inputFiles.forEach(inputFile => {
  const prefix = inputFile.split('.')[0]
  const serviceFile = files.find(f => f.startsWith(prefix + '.') && f.includes('service'))
  const outputFile = inputFile.replace('.input', '.output')

  if (!serviceFile) {
    console.log(`Skipping ${inputFile} — no service file found`)
    return
  }

  const input = JSON.parse(fs.readFileSync(path.resolve(fixturesPath, inputFile)))
  const service = JSON.parse(fs.readFileSync(path.resolve(fixturesPath, serviceFile)))

  const serverless = new Serverless({ commands: [], options })
  Object.assign(serverless.service, service)
  serverless.service.provider.compiledCloudFormationTemplate = JSON.parse(JSON.stringify(input))
  serverless.setProvider('aws', new AwsProvider(serverless, options))
  const plugin = new ServerlessLambdaDeployments(serverless, options)
  plugin.addDeploymentResources()

  const output = serverless.service.provider.compiledCloudFormationTemplate
  fs.writeFileSync(
    path.resolve(fixturesPath, outputFile),
    JSON.stringify(output, null, 2) + '\n'
  )
  console.log(`Regenerated ${outputFile}`)
})
