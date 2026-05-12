'use strict'

const { expect } = require('chai')
const AutoScaling = require('./AutoScaling')

describe('AutoScaling', () => {
  const functionName = 'UpdatecartLambdaFunction'
  const alias = 'live'
  const functionAlias = 'UpdatecartLambdaFunctionAliaslive'
  const scalableTargetLogicalName = 'UpdatecartLambdaFunctionAutoScalingTarget'

  describe('.buildScalableTarget', () => {
    it('generates a valid AWS::ApplicationAutoScaling::ScalableTarget', () => {
      const result = AutoScaling.buildScalableTarget({
        functionName,
        alias,
        functionAlias,
        minCapacity: 1,
        maxCapacity: 700
      })

      expect(result.Type).to.equal('AWS::ApplicationAutoScaling::ScalableTarget')
      expect(result.Properties.MinCapacity).to.equal(1)
      expect(result.Properties.MaxCapacity).to.equal(700)
      expect(result.Properties.ScalableDimension).to.equal('lambda:function:ProvisionedConcurrency')
      expect(result.Properties.ServiceNamespace).to.equal('lambda')
    })

    it('builds ResourceId as function:<functionName>:<alias>', () => {
      const result = AutoScaling.buildScalableTarget({
        functionName,
        alias,
        functionAlias,
        minCapacity: 1,
        maxCapacity: 700
      })

      expect(result.Properties.ResourceId).to.deep.equal({
        'Fn::Join': [':', ['function', { Ref: functionName }, alias]]
      })
    })

    it('adds DependsOn the alias so CloudFormation waits for it', () => {
      const result = AutoScaling.buildScalableTarget({
        functionName,
        alias,
        functionAlias,
        minCapacity: 1,
        maxCapacity: 700
      })

      expect(result.DependsOn).to.equal(functionAlias)
    })
  })

  describe('.buildScalingPolicy', () => {
    it('generates a valid AWS::ApplicationAutoScaling::ScalingPolicy', () => {
      const result = AutoScaling.buildScalingPolicy({
        functionName,
        scalableTargetLogicalName,
        targetUtilization: 0.6
      })

      expect(result.Type).to.equal('AWS::ApplicationAutoScaling::ScalingPolicy')
      expect(result.Properties.PolicyType).to.equal('TargetTrackingScaling')
      expect(result.Properties.ScalingTargetId).to.deep.equal({ Ref: scalableTargetLogicalName })
    })

    it('sets TargetValue from targetUtilization', () => {
      const result = AutoScaling.buildScalingPolicy({
        functionName,
        scalableTargetLogicalName,
        targetUtilization: 0.6
      })

      expect(result.Properties.TargetTrackingScalingPolicyConfiguration.TargetValue).to.equal(0.6)
    })

    it('uses LambdaProvisionedConcurrencyUtilization as the predefined metric', () => {
      const result = AutoScaling.buildScalingPolicy({
        functionName,
        scalableTargetLogicalName,
        targetUtilization: 0.7
      })

      expect(result.Properties.TargetTrackingScalingPolicyConfiguration.PredefinedMetricSpecification)
        .to.deep.equal({ PredefinedMetricType: 'LambdaProvisionedConcurrencyUtilization' })
    })

    it('includes ScaleInCooldown when provided', () => {
      const result = AutoScaling.buildScalingPolicy({
        functionName,
        scalableTargetLogicalName,
        targetUtilization: 0.7,
        scaleInCooldown: 600
      })

      expect(result.Properties.TargetTrackingScalingPolicyConfiguration.ScaleInCooldown).to.equal(600)
    })

    it('includes ScaleOutCooldown when provided', () => {
      const result = AutoScaling.buildScalingPolicy({
        functionName,
        scalableTargetLogicalName,
        targetUtilization: 0.7,
        scaleOutCooldown: 30
      })

      expect(result.Properties.TargetTrackingScalingPolicyConfiguration.ScaleOutCooldown).to.equal(30)
    })

    it('omits cooldowns when not provided', () => {
      const result = AutoScaling.buildScalingPolicy({
        functionName,
        scalableTargetLogicalName,
        targetUtilization: 0.7
      })

      const config = result.Properties.TargetTrackingScalingPolicyConfiguration
      expect(config).to.not.have.property('ScaleInCooldown')
      expect(config).to.not.have.property('ScaleOutCooldown')
    })
  })
})
