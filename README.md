[![npm version](https://badge.fury.io/js/serverless-plugin-lambda-deployments.svg)](https://badge.fury.io/js/serverless-plugin-lambda-deployments)

# serverless-plugin-lambda-deployments

A Serverless Framework v3 plugin that manages Lambda function aliases, providing a stable deployment target that decouples your triggers from specific function versions. Use it as a base for any deployment strategy you want to implement.

## Contents

- [Supported events](#supported-events)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration reference](#configuration-reference)
- [SQS support](#sqs-support)
- [License](#license)
- [Credits](#credits)

## Supported events

The plugin automatically redirects all triggers to the alias for the following event types:

- **HTTP / REST API** (`http`) — API Gateway v1
- **HTTP API** (`httpApi`) — API Gateway v2, including authorizers
- **SQS** (`sqs`)
- **DynamoDB Streams** (`stream`)
- **Kinesis** (`stream`)
- **SNS** (`sns`)
- **S3** (`s3`)
- **Schedule / EventBridge** (`schedule`)
- **CloudWatch Logs** (`cloudwatchLog`)
- **IoT** (`iot`)
- **AppSync** (`appSync`)
- **Destinations** (`destinations` — `onSuccess` / `onFailure`)

## Installation

```bash
npm install --save-dev serverless-plugin-lambda-deployments
```

## Usage

Add the plugin to your `serverless.yml`:

```yaml
plugins:
  - serverless-plugin-lambda-deployments
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
| `provisionedConcurrency` | no | Number of provisioned concurrency instances to keep warm |
| `enabled` | no | Set to `false` to exclude a specific function from the plugin. Default: `true` |

### Global defaults

If `custom.deploymentSettings` includes an `alias`, the plugin applies to **all functions automatically** — no need to add `deploymentSettings` to each one. A function can override the global config by defining its own `deploymentSettings`.

```yaml
custom:
  deploymentSettings:
    alias: live
    stages:
      - prod
      - staging

functions:
  functionA:
    handler: src/functionA.main
    # inherits alias: live from global

  functionB:
    handler: src/functionB.main
    # inherits alias: live from global

  functionC:
    handler: src/functionC.main
    deploymentSettings:
      alias: canary   # overrides global for this function only

  functionD:
    handler: src/functionD.main
    deploymentSettings:
      enabled: false  # excluded from the plugin
```

If `custom.deploymentSettings` does **not** include an `alias`, the global config is only used as a source of default values. Each function must define its own `deploymentSettings` with at least an `alias` to be processed by the plugin — functions without it are ignored.

```yaml
custom:
  deploymentSettings:
    stages:           # no alias → does not activate the plugin globally
      - prod

functions:
  functionA:
    handler: src/functionA.main
    deploymentSettings:
      alias: live     # required — plugin processes this function

  functionB:
    handler: src/functionB.main
    # no deploymentSettings → plugin ignores this function
```

> **Note on `stages`:** the stage filter is evaluated from `custom.deploymentSettings.stages`. If a function defines its own `stages`, it affects the merged config but not the global stage check. For consistent behavior, define `stages` only in `custom.deploymentSettings`.

## SQS support

SQS works out of the box. The plugin automatically intercepts the Event Source Mapping that Serverless generates from `events.sqs` and points it to the alias.

```yaml
functions:
  sqsProcessor:
    handler: src/sqs.main
    events:
      - sqs:
          arn: !GetAtt MyQueue.Arn
          batchSize: 10
    deploymentSettings:
      alias: live
```

## License

ISC © Draftea

## Credits

Inspired by [davidgf/serverless-plugin-canary-deployments](https://github.com/davidgf/serverless-plugin-canary-deployments) by David García Fernández, licensed under ISC.
