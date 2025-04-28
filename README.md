# mytaptrack apis

This project contains the APIs for the mytaptrack solution. This project leverages AWS API Gateway, backed by lambda functions to provide access to the website and mobile apps which are signed in.

## Prerequisites

- NodeJS
- AWS CDK
- ESBuild
- [mytaptrack - Core](https://github.com/mytaptrack/core)

## Deploying the project

After the **mytaptrack core** project has been deployed, this project leverages the configurations which are established for the project in the core configuration.

To deploy the project you can either use the makefile approach:
```bash
make deploy
```

or leverage npm directly
```bash
npm ci
npm run deploy
```
## Development

| Path | Description |
|:---:|:---:|
| /bin | The AWS definitions for the general setup of the stacks which can be deployed as part of this project |
| /lib | The AWS stacks and resources which will be deployed, including the API Gateway, lambda functions, etc |
| /src/graphql | The graphql schema and lambda functions which handle the API Gateway requests |
| /src/v2 | The v2 api for mytaptrack, which is a legacy api often used as a passthrough to the graphql api |
| /src/migration | A set of lambda function code which is used to upgrade the dataset stored in dynamodb |

## Development

The AWS resources can easily be deployed independently leveraging the AWS CDK.

**To deploy the graphql api:**

```bash
cdk deploy graphql
```

**To deploy the graphql api with auto-syncing when code is changed**

```bash
cdk deploy graphql --watch --hotswap
```

**To deploy the api**

```bash
cdk deploy api
```
