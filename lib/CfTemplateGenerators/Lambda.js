const _ = require('lodash/fp')

function buildAlias ({ alias, functionName, functionVersion, provisionedConcurrency }) {
  const properties = {
    FunctionVersion: { 'Fn::GetAtt': [functionVersion, 'Version'] },
    FunctionName: { Ref: functionName },
    Name: alias
  }
  if (provisionedConcurrency) {
    properties.ProvisionedConcurrencyConfig = {
      ProvisionedConcurrentExecutions: provisionedConcurrency
    }
  }
  return { Type: 'AWS::Lambda::Alias', Properties: properties }
}

function replacePermissionFunctionWithAlias (lambdaPermission, funcitonAlias) {
  const newPermission = _.set('Properties.FunctionName', { Ref: funcitonAlias }, lambdaPermission)
  return newPermission
}

function replaceEventMappingFunctionWithAlias (eventSourceMapping, funcitonAlias) {
  const newMapping = _.set('Properties.FunctionName', { Ref: funcitonAlias }, eventSourceMapping)
  return newMapping
}

function replaceEventInvokeConfigWithAlias (eventInvokeConfig, functionAlias, alias) {
  const withQualifier = _.set('Properties.Qualifier', alias, eventInvokeConfig)
  const existingDeps = withQualifier.DependsOn
    ? [].concat(withQualifier.DependsOn)
    : []
  return Object.assign({}, withQualifier, { DependsOn: [...existingDeps, functionAlias] })
}

const Lambda = {
  buildAlias,
  replacePermissionFunctionWithAlias,
  replaceEventMappingFunctionWithAlias,
  replaceEventInvokeConfigWithAlias
}

module.exports = Lambda
