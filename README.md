[![npm version](https://badge.fury.io/js/serverless-plugin-lambda-deployments.svg)](https://badge.fury.io/js/serverless-plugin-lambda-deployments)

# serverless-plugin-lambda-deployments

A Serverless Framework v3 plugin that manages Lambda function aliases, providing a stable deployment target that decouples your triggers from specific function versions. Use it as a base for any deployment strategy you want to implement.

## Contents

- [Installation](#installation)
- [Usage](#usage)
- [Configuration reference](#configuration-reference)
- [SQS support](#sqs-support)
- [License](#license)
- [Credits](#credits)

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

Inspired by [davidgf/serverless-plugin-canary-deployments](https://github.com/davidgf/serverless-plugin-canary-deployments) by David García Fernández, licensed under MIT.
