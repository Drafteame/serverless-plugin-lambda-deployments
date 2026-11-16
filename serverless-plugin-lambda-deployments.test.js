const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const chai = require('chai')
const _ = require('lodash/fp')
const { getInstalledPathSync } = require('get-installed-path')
const ServerlessLambdaDeployments = require('./serverless-plugin-lambda-deployments')

const serverlessPath = getInstalledPathSync('serverless', { local: true })
const Serverless = require(`${serverlessPath}/lib/Serverless`)
const serverlessVersion = parseInt(require(`${serverlessPath}/package.json`).version)
const AwsProvider = serverlessVersion > 1
  ? require(`${serverlessPath}/lib/plugins/aws/provider`)
  : require(`${serverlessPath}/lib/plugins/aws/provider/awsProvider`)
const { expect } = chai
const fixturesPath = path.resolve(__dirname, 'fixtures')

describe('ServerlessLambdaDeployments', () => {
  const stage = 'dev'
  const options = { stage }

  describe('addDeploymentResources', () => {
    const testCaseFiles = fs.readdirSync(fixturesPath)
    const getTestCaseName = _.pipe(_.split('.'), _.head)
    const testCaseFileType = _.pipe(_.split('.'), _.get('[1]'))
    const testCaseContentsFromFiles = _.reduce((acc, fileName) => {
      const contents = JSON.parse(fs.readFileSync(path.resolve(fixturesPath, fileName)))
      return _.set(testCaseFileType(fileName), contents, acc)
    }, {})
    const testCaseFilesByName = _.groupBy(getTestCaseName, testCaseFiles)
    this.testCases = _.map(
      (caseName) => {
        const testCaseContents = testCaseContentsFromFiles(testCaseFilesByName[caseName])
        return Object.assign(testCaseContents, { caseName })
      },
      Object.keys(testCaseFilesByName)
    )

    this.testCases.forEach(({ caseName, input, output, service }) => {
      it(`generates the correct CloudFormation templates: test case ${caseName}`, () => {
        const serverless = new Serverless({ commands: [], options })
        Object.assign(serverless.service, service)
        serverless.service.provider.compiledCloudFormationTemplate = input
        serverless.setProvider('aws', new AwsProvider(serverless, options))
        const plugin = new ServerlessLambdaDeployments(serverless, options)
        plugin.addDeploymentResources()
        expect(serverless.service.provider.compiledCloudFormationTemplate).to.deep.equal(output)
      })
    })

    it('keeps the alias of every function subscribed to a shared SNS topic', () => {
      const resources = {
        ...fnResources('A'),
        ...fnResources('B'),
        SNSTopicShared: {
          Type: 'AWS::SNS::Topic',
          Properties: {
            Subscription: [
              { Endpoint: { 'Fn::GetAtt': ['ALambdaFunction', 'Arn'] }, Protocol: 'lambda' },
              { Endpoint: { 'Fn::GetAtt': ['BLambdaFunction', 'Arn'] }, Protocol: 'lambda' }
            ]
          }
        }
      }
      fakePlugin({ resources }).addDeploymentResources()
      expect(_.map('Endpoint', resources.SNSTopicShared.Properties.Subscription)).to.have.deep.members([
        { Ref: 'ALambdaFunctionAliaslive' },
        { Ref: 'BLambdaFunctionAliaslive' }
      ])
    })

    it('fails with a clear error when a function has no version', () => {
      const resources = { ALambdaFunction: { Type: 'AWS::Lambda::Function', Properties: {} } }
      expect(() => fakePlugin({ resources, functions: ['a'] }).addDeploymentResources()).to.throw(/has no AWS::Lambda::Version/)
    })
  })

  describe('stabilizeVersions', () => {
    const variables = ['APP_VERSION']
    const settings = { alias: 'live', stableVersions: { variables } }
    const deployed = { APP_VERSION: 'old' }

    it('keeps the deployed variables when the zip matches the code the alias runs', async () => {
      const zip = zipFile('same binary')
      const plugin = fakePlugin({ settings, artifact: zip.file, request: async () => ({ CodeSha256: zip.sha, Environment: { Variables: deployed } }) })
      await plugin.stabilizeVersions()
      expect(plugin.service.getFunction('a').environment).to.deep.equal(deployed)
    })

    it('uses this deploy variables when the code changed', async () => {
      const zip = zipFile('new binary')
      const plugin = fakePlugin({ settings, artifact: zip.file, request: async () => ({ CodeSha256: 'other', Environment: { Variables: deployed } }) })
      await plugin.stabilizeVersions()
      expect(plugin.service.getFunction('a').environment).to.equal(undefined)
    })

    it('falls back to $LATEST when the alias does not exist yet', async () => {
      const zip = zipFile('same binary')
      const qualifiers = []
      const plugin = fakePlugin({
        settings,
        artifact: zip.file,
        request: async (_service, _method, params) => {
          qualifiers.push(params.Qualifier)
          if (params.Qualifier) throw notFound()
          return { CodeSha256: zip.sha, Environment: { Variables: deployed } }
        }
      })
      await plugin.stabilizeVersions()
      expect(qualifiers).to.deep.equal(['live', undefined])
      expect(plugin.service.getFunction('a').environment).to.deep.equal(deployed)
    })

    it('never fails the deploy when AWS cannot be read', async () => {
      const zip = zipFile('binary')
      const plugin = fakePlugin({ settings, artifact: zip.file, request: async () => { throw Object.assign(new Error('Rate exceeded'), { code: 'THROTTLED' }) } })
      await plugin.stabilizeVersions()
      expect(plugin.service.getFunction('a').environment).to.equal(undefined)
    })

    it('does not call AWS when stableVersions is not set', async () => {
      const zip = zipFile('binary')
      const plugin = fakePlugin({ artifact: zip.file, request: async () => { throw new Error('unexpected call') } })
      await plugin.stabilizeVersions()
    })
  })

  describe('syncAliases', () => {
    const settings = { alias: 'live', syncAlias: true }
    const stackPages = [
      { StackResourceSummaries: [{ LogicalResourceId: 'OtherLambdaVersion', ResourceType: 'AWS::Lambda::Version', PhysicalResourceId: 'arn:aws:lambda:us-east-2:1:function:other:3' }], NextToken: 'page2' },
      { StackResourceSummaries: [{ LogicalResourceId: 'ALambdaVersionX', ResourceType: 'AWS::Lambda::Version', PhysicalResourceId: 'arn:aws:lambda:us-east-2:1:function:svc-dev-a:12' }] }
    ]
    const awsWith = (aliasVersion, calls) => async (service, method, params) => {
      calls.push(method)
      if (method === 'listStackResources') return params.NextToken ? stackPages[1] : stackPages[0]
      if (method === 'getAlias') return { FunctionVersion: aliasVersion }
      return {}
    }

    it('moves an alias left behind (e.g. by a rollback) to the stack version', async () => {
      const calls = []
      await fakePlugin({ settings, request: awsWith('9', calls) }).syncAliases()
      expect(calls).to.deep.equal(['listStackResources', 'listStackResources', 'getAlias', 'updateAlias'])
    })

    it('does not update an alias already on the stack version', async () => {
      const calls = []
      await fakePlugin({ settings, request: awsWith('12', calls) }).syncAliases()
      expect(calls).to.not.include('updateAlias')
    })

    it('never fails the deploy when the alias cannot be updated', async () => {
      const plugin = fakePlugin({
        settings,
        request: async (service, method) => {
          if (method === 'listStackResources') return stackPages[1]
          if (method === 'getAlias') return { FunctionVersion: '9' }
          throw new Error('AccessDenied')
        }
      })
      await plugin.syncAliases()
    })

    it('does not call AWS when syncAlias is not set', async () => {
      await fakePlugin({ request: async () => { throw new Error('unexpected call') } }).syncAliases()
    })
  })
})

function fnResources (prefix) {
  const fn = `${prefix}LambdaFunction`
  return {
    [fn]: { Type: 'AWS::Lambda::Function', Properties: {} },
    [`${prefix}LambdaVersionX`]: { Type: 'AWS::Lambda::Version', Properties: { FunctionName: { Ref: fn } } },
    [`${prefix}LambdaPermission`]: { Type: 'AWS::Lambda::Permission', Properties: { FunctionName: { 'Fn::GetAtt': [fn, 'Arn'] } } }
  }
}

// Plugin over a minimal fake Serverless: functions 'a', 'b'... map to logical ids ALambdaFunction...
function fakePlugin ({ settings = { alias: 'live' }, functions, resources, artifact, request } = {}) {
  const names = functions || (resources ? ['a', 'b'] : ['a'])
  const fns = Object.fromEntries(names.map(n => [n, { name: `svc-dev-${n}`, package: { artifact } }]))
  const service = {
    provider: { environment: { APP_VERSION: 'new' }, compiledCloudFormationTemplate: { Resources: resources || fnResources('A') } },
    custom: { deploymentSettings: settings },
    getAllFunctions: () => names,
    getFunction: name => fns[name]
  }
  const provider = {
    naming: { getLambdaLogicalId: n => `${n.toUpperCase()}LambdaFunction`, getStackName: () => 'svc-dev' },
    getStage: () => 'dev',
    request
  }
  const quiet = { log: { notice () {}, warning () {} } }
  return new ServerlessLambdaDeployments({ service, getProvider: () => provider }, {}, quiet)
}

function zipFile (content) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sld-')), 'fn.zip')
  fs.writeFileSync(file, content)
  return { file, sha: crypto.createHash('sha256').update(content).digest('base64') }
}

function notFound () {
  return Object.assign(new Error('Function not found'), { code: 'AWS_LAMBDA_GET_FUNCTION_CONFIGURATION_RESOURCE_NOT_FOUND_EXCEPTION' })
}
