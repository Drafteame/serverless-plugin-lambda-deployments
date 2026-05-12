[![npm version](https://badge.fury.io/js/%40drafteame%2Fserverless-plugin-lambda-deployments.svg)](https://badge.fury.io/js/%40drafteame%2Fserverless-plugin-lambda-deployments)

# serverless-plugin-lambda-deployments

A Serverless Framework v3 plugin to manage deployment strategies for AWS Lambda functions. Supports Blue/Green deployments without CodeDeploy, as well as Canary and Linear traffic shifting with CodeDeploy.

## Contents

- [Installation](#installation)
- [Usage](#usage)
- [Deployment strategies](#deployment-strategies)
- [Configuration reference](#configuration-reference)
- [SQS support](#sqs-support)
- [Provisioned Concurrency + Auto Scaling](#provisioned-concurrency--auto-scaling)
- [License](#license)
- [Credits](#credits)

## Installation

```bash
npm install --save-dev @drafteame/serverless-plugin-lambda-deployments
```

## Usage

Add the plugin to your `serverless.yml`:

```yaml
plugins:
  - '@drafteame/serverless-plugin-lambda-deployments'
```

Then add `deploymentSettings` to any function you want to manage:

```yaml
functions:
  myFunction:
    handler: src/handler.main
    events:
      - http: GET /my-endpoint
    deploymentSettings:
      type: BlueGreen
      alias: live
```

## Deployment strategies

### BlueGreen

Instant 100% traffic switch. No CodeDeploy required. CloudFormation updates the alias directly on each deploy. Rollback is a manual alias update.

```yaml
deploymentSettings:
  type: BlueGreen
  alias: live
```

### Canary

Gradual traffic shifting with CodeDeploy. Shifts 10% of traffic first, then the remaining 90% after a configurable delay.

```yaml
deploymentSettings:
  type: Canary10Percent5Minutes   # or 10Minutes, 15Minutes, 30Minutes
  alias: live
  alarms:
    - MyFunctionErrors
  preTrafficHook: preHookFunction
  postTrafficHook: postHookFunction
```

### Linear

Incremental traffic shifting with CodeDeploy. Shifts traffic in equal increments over time.

```yaml
deploymentSettings:
  type: Linear10PercentEvery1Minute   # or Every2Minutes, Every3Minutes, Every10Minutes
  alias: live
  alarms:
    - MyFunctionErrors
```

### AllAtOnce

Instant switch via CodeDeploy. Useful when you want validation hooks without gradual shifting.

```yaml
deploymentSettings:
  type: AllAtOnce
  alias: live
  preTrafficHook: preHookFunction
  postTrafficHook: postHookFunction
```

## Configuration reference

| Field | Required | Description |
|---|---|---|
| `type` | yes | Deployment strategy: `BlueGreen`, `Canary*`, `Linear*`, `AllAtOnce` |
| `alias` | yes | Name of the Lambda alias to create (e.g. `live`) |
| `alarms` | no | List of CloudWatch alarm logical IDs. Triggers auto-rollback on Canary/Linear deployments |
| `preTrafficHook` | no | Function name to run before traffic shifting (Canary/Linear/AllAtOnce only) |
| `postTrafficHook` | no | Function name to run after traffic shifting (Canary/Linear/AllAtOnce only) |
| `stages` | no | List of stages where the plugin is active. If omitted, applies to all stages |
| `provisionedConcurrency` | no | Number of provisioned concurrency instances (minimum when combined with `autoScaling`) |
| `autoScaling` | no | Auto scaling config for provisioned concurrency. See below |

### Global defaults

You can define shared settings under `custom.deploymentSettings` and reference them per function using YAML anchors:

```yaml
custom:
  deploymentSettings: &deploymentDefaults
    type: BlueGreen
    alias: live
    stages:
      - prod
      - staging

functions:
  functionA:
    handler: src/functionA.main
    deploymentSettings: *deploymentDefaults

  functionB:
    handler: src/functionB.main
    deploymentSettings:
      <<: *deploymentDefaults
      type: Canary10Percent5Minutes
```

## SQS support

When using SQS with an alias, define the Event Source Mapping manually in `resources` instead of using `events.sqs`. This ensures the ESM points to the alias rather than `$LATEST`.

```yaml
functions:
  sqsProcessor:
    handler: src/sqs.main
    deploymentSettings:
      type: BlueGreen
      alias: live

resources:
  Resources:
    MyQueue:
      Type: AWS::SQS::Queue

    SqsProcessorESM:
      Type: AWS::Lambda::EventSourceMapping
      Properties:
        EventSourceArn: !GetAtt MyQueue.Arn
        FunctionName: !Sub "${AWS::StackName}-sqsProcessor:live"
        BatchSize: 10
        Enabled: true
```

Since `events.sqs` is not used, you need to add SQS permissions manually:

```yaml
provider:
  iam:
    role:
      statements:
        - Effect: Allow
          Action:
            - sqs:ReceiveMessage
            - sqs:DeleteMessage
            - sqs:GetQueueAttributes
          Resource: !GetAtt MyQueue.Arn
```

## Provisioned Concurrency + Auto Scaling

When both `provisionedConcurrency` and `autoScaling` are set, the plugin creates an `AWS::ApplicationAutoScaling::ScalableTarget` and a `TargetTrackingScaling` policy that adjusts provisioned concurrency based on utilization.

```yaml
deploymentSettings:
  type: BlueGreen
  alias: live
  provisionedConcurrency: 5      # minimum instances
  autoScaling:
    maxCapacity: 50              # maximum instances
    targetUtilization: 0.7      # scale up when utilization exceeds 70% (default: 0.7)
    scaleInCooldown: 600        # seconds to wait before scaling in (optional)
    scaleOutCooldown: 30        # seconds to wait before scaling out (optional)
```

## License

ISC © Ariel Santos

## Credits

Inspired by [davidgf/serverless-plugin-lambda-deployments](https://github.com/davidgf/serverless-plugin-lambda-deployments) by David García Fernández, licensed under MIT.
