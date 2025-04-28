import { App } from 'aws-cdk-lib';
import { AppSyncStack } from '../lib/app-sync';
import { ApiV2Stack } from '../lib/api-v2';

// Usage
const app = new App();

const ENVIRONMENT = process.env.STAGE ?? 'test';
console.log('Account:', process.env.CDK_DEFAULT_ACCOUNT, ' Region:', process.env.CDK_DEFAULT_REGION, 'Environment:', ENVIRONMENT);

new AppSyncStack(app, 'graphql', {
  stackName: `mytaptrack-graphql-api-${ENVIRONMENT}`,
  environment: ENVIRONMENT ?? 'test',
  coreStack: ENVIRONMENT == 'prod'? 'mytaptrack-prod' : 'mytaptrack-test',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});

new ApiV2Stack(app, 'api', {
  stackName: `mytaptrack-api-${ENVIRONMENT}`,
  environment: ENVIRONMENT ?? 'test',
  coreStack: ENVIRONMENT == 'prod'? 'mytaptrack-prod' : 'mytaptrack-test',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});

app.synth();
