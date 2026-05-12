'use strict'

function buildScalableTarget ({ functionName, alias, functionAlias, minCapacity, maxCapacity }) {
  return {
    Type: 'AWS::ApplicationAutoScaling::ScalableTarget',
    DependsOn: functionAlias,
    Properties: {
      MaxCapacity: maxCapacity,
      MinCapacity: minCapacity,
      ResourceId: {
        'Fn::Join': [':', ['function', { Ref: functionName }, alias]]
      },
      ScalableDimension: 'lambda:function:ProvisionedConcurrency',
      ServiceNamespace: 'lambda'
    }
  }
}

function buildScalingPolicy ({ functionName, scalableTargetLogicalName, targetUtilization, scaleInCooldown, scaleOutCooldown }) {
  const trackingConfig = {
    TargetValue: targetUtilization,
    PredefinedMetricSpecification: {
      PredefinedMetricType: 'LambdaProvisionedConcurrencyUtilization'
    }
  }
  if (scaleInCooldown !== undefined) trackingConfig.ScaleInCooldown = scaleInCooldown
  if (scaleOutCooldown !== undefined) trackingConfig.ScaleOutCooldown = scaleOutCooldown

  return {
    Type: 'AWS::ApplicationAutoScaling::ScalingPolicy',
    Properties: {
      PolicyName: `${functionName}-provisioned-concurrency-tracking`,
      PolicyType: 'TargetTrackingScaling',
      ScalingTargetId: { Ref: scalableTargetLogicalName },
      TargetTrackingScalingPolicyConfiguration: trackingConfig
    }
  }
}

module.exports = { buildScalableTarget, buildScalingPolicy }
