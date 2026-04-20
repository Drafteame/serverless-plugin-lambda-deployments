const _ = require('lodash/fp')

function buildAlias ({ alias, functionName, functionVersion }) {
  return {
    Type: 'AWS::Lambda::Alias',
    Properties: {
      FunctionVersion: { 'Fn::GetAtt': [functionVersion, 'Version'] },
      FunctionName: { Ref: functionName },
      Name: alias
    }
  }
}

function replacePermissionFunctionWithAlias (lambdaPermission, funcitonAlias) {
  const newPermission = _.set('Properties.FunctionName', { Ref: funcitonAlias }, lambdaPermission)
  return newPermission
}

function replaceEventMappingFunctionWithAlias (eventSourceMapping, funcitonAlias) {
  const newMapping = _.set('Properties.FunctionName', { Ref: funcitonAlias }, eventSourceMapping)
  return newMapping
}

const Lambda = {
  buildAlias,
  replacePermissionFunctionWithAlias,
  replaceEventMappingFunctionWithAlias
}

module.exports = Lambda
