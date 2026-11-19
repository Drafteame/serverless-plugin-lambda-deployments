const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const chai = require('chai')
const _ = require('lodash/fp')
const { getInstalledPathSync } = require('get-installed-path')
const ServerlessLambdaDeployments = require('./serverless-plugin-lambda-deployments')

const serverlessPath = getInstalledPathSync('serverless', { local: true })
const Serverless = require(`${serverlessPath}/lib/serverless`)
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

    it('recognizes a missing alias from the osls provider.request shim, which drops the error code', async () => {
      const zip = zipFile('same binary')
      const plugin = fakePlugin({
        settings,
        artifact: zip.file,
        request: async (_service, _method, params) => {
          if (params.Qualifier) throw new Error('Error calling Lambda.getFunctionConfiguration: Function not found: arn:aws:lambda:us-east-2:1:function:svc-dev-a:live')
          return { CodeSha256: zip.sha, Environment: { Variables: deployed } }
        }
      })
      await plugin.stabilizeVersions()
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

  describe('contentAddressedArtifacts', () => {
    const settings = { alias: 'live', contentAddressedArtifacts: true }
    const oldKey = 'serverless/svc/dev/1700-2024-01-01T00:00:00/fn.zip'
    const codeResources = () => {
      const resources = fnResources('A')
      resources.ALambdaFunction.Properties = { Code: { S3Bucket: { Ref: 'ServerlessDeploymentBucket' }, S3Key: oldKey } }
      return resources
    }
    const run = async ({ settings: s = settings, request, zip = zipFile('binary') } = {}) => {
      const resources = codeResources()
      const plugin = fakePlugin({ settings: s, artifact: zip.file, resources, functions: ['a'], request })
      plugin.addressArtifactsByContent()
      await plugin.uploadMissingArtifacts()
      return { resources, plugin, key: `serverless/svc/dev/code/${zip.hex}.zip` }
    }

    it('rewrites the S3Key to the sha256 of the zip', async () => {
      const zip = zipFile('binary')
      const { resources, key } = await run({ zip, request: async () => ({}) })
      expect(resources.ALambdaFunction.Properties.Code.S3Key).to.equal(key)
    })

    it('uploads only the zips code/ does not have', async () => {
      const calls = []
      const request = async (_s, method, params) => {
        calls.push([method, params.Key, params.ServerSideEncryption])
        if (method === 'headObject') throw Object.assign(new Error('x'), { code: 'AWS_S3_HEAD_OBJECT_NOT_FOUND' })
        return {}
      }
      const { key } = await run({ request })
      expect(calls).to.deep.equal([['headObject', key, undefined], ['putObject', key, undefined]])
    })

    it('does not upload a zip that code/ already has', async () => {
      const calls = []
      await run({ request: async (_s, method) => { calls.push(method); return {} } })
      expect(calls).to.deep.equal(['headObject'])
    })

    it('uploads anyway when HeadObject fails', async () => {
      const calls = []
      const { resources, key } = await run({
        request: async (_s, method) => {
          calls.push(method)
          if (method === 'headObject') throw Object.assign(new Error('denied'), { code: 'AWS_S3_HEAD_OBJECT_FORBIDDEN' })
          return {}
        }
      })
      expect(calls).to.deep.equal(['headObject', 'putObject'])
      expect(resources.ALambdaFunction.Properties.Code.S3Key).to.equal(key)
    })

    it('puts the function back on the deploy folder when the upload fails', async () => {
      const zip = zipFile('binary')
      const request = async (_s, method) => { throw Object.assign(new Error(method), { code: 'AWS_S3_ERROR' }) }
      const plugin = fakePlugin({ settings, artifact: zip.file, resources: codeResources(), functions: ['a'], request })
      plugin.addressArtifactsByContent()
      // Before deploying, Serverless reloads the packaged state, which replaces the template object.
      const reloaded = JSON.parse(JSON.stringify(plugin.service.provider.compiledCloudFormationTemplate))
      plugin.service.provider = { ...plugin.service.provider, compiledCloudFormationTemplate: reloaded }
      await plugin.uploadMissingArtifacts()
      expect(reloaded.Resources.ALambdaFunction.Properties.Code.S3Key).to.equal(oldKey)
    })

    it('does not touch the template or call AWS when the option is off', async () => {
      const { resources } = await run({
        settings: { alias: 'live' },
        request: async () => { throw new Error('unexpected call') }
      })
      expect(resources.ALambdaFunction.Properties.Code.S3Key).to.equal(oldKey)
    })

    it('does not upload when Serverless found no changes to deploy', async () => {
      const zip = zipFile('binary')
      const plugin = fakePlugin({ settings, artifact: zip.file, resources: codeResources(), functions: ['a'], request: async () => { throw new Error('unexpected call') } })
      plugin.addressArtifactsByContent()
      plugin.service.provider.shouldNotDeploy = true
      await plugin.uploadMissingArtifacts()
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

    it('never fails the deploy when the stack resources cannot be listed', async () => {
      const warnings = []
      const plugin = fakePlugin({ settings, request: async () => { throw Object.assign(new Error('not authorized'), { code: 'AccessDenied' }) } })
      plugin.log = { notice () {}, warning: w => warnings.push(w) }
      await plugin.syncAliases()
      expect(warnings).to.have.lengthOf(1)
      expect(warnings[0]).to.match(/aliases not synced \(AccessDenied\)/)
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
    service: 'svc',
    provider: { environment: { APP_VERSION: 'new' }, compiledCloudFormationTemplate: { Resources: resources || fnResources('A') } },
    custom: { deploymentSettings: settings },
    getAllFunctions: () => names,
    getFunction: name => fns[name]
  }
  const provider = {
    naming: { getLambdaLogicalId: n => `${n.toUpperCase()}LambdaFunction`, getStackName: () => 'svc-dev' },
    getStage: () => 'dev',
    getDeploymentPrefix: () => 'serverless',
    getServerlessDeploymentBucketName: async () => 'bucket',
    request
  }
  const quiet = { log: { notice () {}, warning () {} } }
  return new ServerlessLambdaDeployments({ service, getProvider: () => provider }, {}, quiet)
}

function zipFile (content) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sld-')), 'fn.zip')
  fs.writeFileSync(file, content)
  const digest = crypto.createHash('sha256').update(content).digest()
  return { file, sha: digest.toString('base64'), hex: digest.toString('hex') }
}

function notFound () {
  return Object.assign(new Error('Function not found'), { code: 'AWS_LAMBDA_GET_FUNCTION_CONFIGURATION_RESOURCE_NOT_FOUND_EXCEPTION' })
}
