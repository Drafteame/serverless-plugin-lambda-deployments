const { expect } = require('chai')
const _ = require('lodash/fp')
const Lambda = require('./Lambda')

describe('Lambda', () => {
  describe('.buildAlias', () => {
    const functionName = 'MyFunctionName'
    const functionVersion = 'MyFunctionVersion'
    const alias = 'live'
    const baseAlias = {
      Type: 'AWS::Lambda::Alias',
      Properties: {
        FunctionVersion: { 'Fn::GetAtt': [functionVersion, 'Version'] },
        FunctionName: { Ref: functionName },
        Name: alias
      }
    }

    it('should generate a AWS::Lambda::Alias resouce', () => {
      const expected = baseAlias
      const actual = Lambda.buildAlias({ alias, functionName, functionVersion })
      expect(actual).to.deep.equal(expected)
    })

    it('should include ProvisionedConcurrencyConfig when provisionedConcurrency is set', () => {
      const expected = _.set(
        'Properties.ProvisionedConcurrencyConfig',
        { ProvisionedConcurrentExecutions: 5 },
        baseAlias
      )
      const actual = Lambda.buildAlias({ alias, functionName, functionVersion, provisionedConcurrency: 5 })
      expect(actual).to.deep.equal(expected)
    })

    it('should not include ProvisionedConcurrencyConfig when provisionedConcurrency is absent', () => {
      const actual = Lambda.buildAlias({ alias, functionName, functionVersion })
      expect(actual.Properties).to.not.have.property('ProvisionedConcurrencyConfig')
    })
  })

  describe('.replacePermissionFunctionWithAlias', () => {
    const lambdaPermission = {
      Type: 'AWS::Lambda::Permission',
      Properties: {
        FunctionName: { 'Fn::GetAtt': ['HelloLambdaFunctionAliasLive', 'Arn'] },
        Action: 'lambda:InvokeFunction',
        Principal: 'apigateway.amazonaws.com',
        SourceArn: {
          'Fn::Join': [
            '',
            [
              'arn:aws:execute-api:',
              { Ref: 'AWS::Region' },
              ':',
              { Ref: 'AWS::AccountId' },
              ':',
              { Ref: 'ApiGatewayRestApi' },
              '/*/*'
            ]
          ]
        }
      }
    }

    it('replaces the permission\'s function for an alias', () => {
      const functionAlias = 'TheFunctionAlias'
      const permissionFunctionWithAlias = { Ref: functionAlias }
      const expected = _.set('Properties.FunctionName', permissionFunctionWithAlias, lambdaPermission)
      const actual = Lambda.replacePermissionFunctionWithAlias(lambdaPermission, functionAlias)
      expect(actual).to.deep.equal(expected)
    })
  })

  describe('.replaceEventMappingFunctionWithAlias', () => {
    const eventSourceMapping = {
      Type: 'AWS::Lambda::EventSourceMapping',
      DependsOn: 'IamRoleLambdaExecution',
      Properties: {
        BatchSize: 10,
        EventSourceArn: { 'Fn::GetAtt': ['StreamsTestTable', 'StreamArn'] },
        FunctionName: { 'Fn::GetAtt': ['HelloLambdaFunction', 'Arn'] },
        StartingPosition: 'TRIM_HORIZON',
        Enabled: 'True'
      }
    }

    it('replaces the event source mapping\'s function for an alias', () => {
      const functionAlias = 'TheFunctionAlias'
      const eventMappingFunctionWithAlias = { Ref: functionAlias }
      const expected = _.set('Properties.FunctionName', eventMappingFunctionWithAlias, eventSourceMapping)
      const actual = Lambda.replaceEventMappingFunctionWithAlias(eventSourceMapping, functionAlias)
      expect(actual).to.deep.equal(expected)
    })
  })

  describe('.replaceEventInvokeConfigWithAlias', () => {
    const functionAlias = 'MyFunctionAliasLive'
    const alias = 'live'
    const eventInvokeConfig = {
      Type: 'AWS::Lambda::EventInvokeConfig',
      Properties: {
        FunctionName: { Ref: 'MyFunctionLambdaFunction' },
        MaximumRetryAttempts: 0,
        DestinationConfig: {
          OnSuccess: { Destination: { 'Fn::GetAtt': ['MyQueue', 'Arn'] } }
        }
      }
    }

    it('sets the qualifier to the alias name', () => {
      const result = Lambda.replaceEventInvokeConfigWithAlias(eventInvokeConfig, functionAlias, alias)
      expect(result.Properties.Qualifier).to.equal(alias)
    })

    it('adds DependsOn the alias to prevent creation before alias exists', () => {
      const result = Lambda.replaceEventInvokeConfigWithAlias(eventInvokeConfig, functionAlias, alias)
      expect(result.DependsOn).to.include(functionAlias)
    })

    it('preserves existing DependsOn entries', () => {
      const withDeps = Object.assign({}, eventInvokeConfig, { DependsOn: 'IamRoleLambdaExecution' })
      const result = Lambda.replaceEventInvokeConfigWithAlias(withDeps, functionAlias, alias)
      expect(result.DependsOn).to.include.members(['IamRoleLambdaExecution', functionAlias])
    })
  })
})
