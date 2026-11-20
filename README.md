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
| `stableVersions.variables` | no | Environment variables that carry per-release values (e.g. the release commit). When a function's zip matches the code its alias runs, their deployed values are kept, so the function publishes no new version. See [Stable versions](#stable-versions) |
| `contentAddressedArtifacts` | no | Name the uploaded zips by their sha256 so unchanged functions keep their `Code.S3Key`. See [Content-addressed artifacts](#content-addressed-artifacts). Default: `false` |
| `syncAlias` | no | After each deploy, point the alias at the version the stack declares, even if it was moved outside CloudFormation. See [Alias sync](#alias-sync). Default: `false` |
| `releaseOutput` | no | Release identifier (e.g. `${param:version}`). Adds it to the stack as `Outputs.ReleaseTag`, so a release does not need a stack tag that CloudFormation copies to every resource. Respects `stages`. Only in `custom.deploymentSettings`. Nothing is added when unset |

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

### Stable versions

Serverless names each `AWS::Lambda::Version` after a hash of the function's zip **and** its configuration, environment variables included. A variable that changes on every release (a commit or version string) therefore publishes a new version of every function, moves every alias and cold-starts every function, even when only one changed.

```yaml
custom:
  deploymentSettings:
    alias: live
    stableVersions:
      variables: [APP_VERSION, DD_VERSION, DD_GIT_COMMIT_SHA]
```

Before the functions are compiled, the plugin compares each function's zip (sha256) with the `CodeSha256` of the version its alias runs (`$LATEST` when the alias does not exist yet):

- **Same code:** the listed variables keep their deployed values, so the version hash does not change and CloudFormation publishes no new version. Each function keeps reporting the release in which its code last changed.
- **Different code, new function, or AWS cannot be read:** the variables keep this deploy's values, as without the option. The plugin never fails a deploy.

It needs reproducible zips (the same code must produce a byte-identical zip); otherwise every function counts as changed. It makes one `lambda:GetFunctionConfiguration` call per function.

### Content-addressed artifacts

Serverless uploads the zips to a new folder on every deploy, so every function's `Code.S3Key` changes and CloudFormation runs `UpdateFunctionCode` on all functions, even when the zip is identical. With `contentAddressedArtifacts: true` the plugin points each function at `serverless/<service>/<stage>/code/<sha256>.zip` instead, and uploads (before Serverless uploads its artifacts) only the zips that `code/` does not have yet. The key changes only when the code does.

```yml
custom:
  deploymentSettings:
    alias: live
    contentAddressedArtifacts: true
```

- Serverless still uploads its own copy of the zips to the deploy folder: its "No changes to deploy" check compares them.
- The bucket's SSE/KMS settings (`provider.deploymentBucketObject`) apply to the uploads.
- If `HeadObject` fails the zip is uploaded anyway. If the upload fails, the function goes back to the deploy folder's key and the deploy continues.
- `maxPreviousDeploymentArtifacts` cleanup and `serverless-plugin-s3-remover` only match deploy folders (`<timestamp>-<date>`), so they leave `code/` alone.
- Do not expire `code/` with a bucket lifecycle rule. A function that has not changed in months still points at an old zip, and if a deploy of that function fails CloudFormation rolls it back to that key: with the zip gone the stack ends in `UPDATE_ROLLBACK_FAILED`. Only a new zip is uploaded when the code changes, so the S3 cost is small. If it grows, clean up by deleting only the keys the current stack does not use.
- It needs the zips in the same run: `sls deploy --package` on a package built earlier with `sls package` would point at `code/` without ever uploading the zips. Package and deploy in one run.

### Alias sync

A tool that moves aliases outside CloudFormation (for example a rollback that points `live` at an older version) leaves the stack out of sync. A later deploy only moves the alias if the function's version changes, so redeploying the same code leaves the alias on the old version. With reproducible zips, and especially with `stableVersions`, that is the common case.

```yaml
custom:
  deploymentSettings:
    alias: live
    syncAlias: true
```

After every deploy, including one Serverless skips because nothing changed, the plugin reads the stack's versions (`cloudformation:ListStackResources`) and, for each function whose alias points elsewhere, moves it to the stack's version (`lambda:GetAlias`, `lambda:UpdateAlias`). A failure is logged as a warning and does not fail the deploy.

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
