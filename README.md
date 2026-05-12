[![npm version](https://badge.fury.io/js/%40drafteame%2Fserverless-plugin-lambda-deployments.svg)](https://badge.fury.io/js/%40drafteame%2Fserverless-plugin-lambda-deployments)

# serverless-plugin-lambda-deployments

A Serverless Framework v3 plugin to manage Blue/Green deployments for AWS Lambda functions. No CodeDeploy required.

## Contents

- [Installation](#installation)
- [Usage](#usage)
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
      alias: live
```

On each deploy, the plugin publishes a new Lambda version and switches the alias to point to it instantly. Rollback is a manual alias update:

```bash
aws lambda update-alias \
  --function-name my-function \
  --name live \
  --function-version <previous-version>
```

## Configuration reference

| Field | Required | Description |
|---|---|---|
| `alias` | yes | Name of the Lambda alias to create (e.g. `live`) |
| `stages` | no | List of stages where the plugin is active. If omitted, applies to all stages |
| `provisionedConcurrency` | no | Number of provisioned concurrency instances (minimum when combined with `autoScaling`) |
| `autoScaling` | no | Auto scaling config for provisioned concurrency. See below |

### Global defaults

You can define shared settings under `custom.deploymentSettings` and reference them per function using YAML anchors:

```yaml
custom:
  deploymentSettings: &deploymentDefaults
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
    deploymentSettings: *deploymentDefaults
```

Note: `stages` can be omitted from the anchor and set per-environment via `--stage` flag.

## SQS support

When using SQS with an alias, define the Event Source Mapping manually in `resources` instead of using `events.sqs`. This ensures the ESM points to the alias rather than `$LATEST`.

```yaml
functions:
  sqsProcessor:
    handler: src/sqs.main
    deploymentSettings:
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
