import { Fn, Stack, CfnOutput, Duration } from 'aws-cdk-lib';
import { AppApiStackProps } from './params';
import { Construct } from 'constructs';
import {
    MttContext, MttDynamoDB, MttS3, 
    MttRestApi, MttTimestream, MttCognito, MttParameter, AppSyncApi 
} from '@mytaptrack/cdk';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as awscognito from 'aws-cdk-lib/aws-cognito';
import { ApiV2AppApi } from './api-v2-subs/app-apis';
import { ApiV2LicenseApi } from './api-v2-subs/license-apis';
import { ApiV2ManageApi } from './api-v2-subs/manage-apis';
import { ApiV2ReportApi } from './api-v2-subs/report-apis';
import { ApiV2StudentApi } from './api-v2-subs/student.apis';
import { ApiV2UserApi } from './api-v2-subs/user-apis';

export class ApiV2Stack extends Stack {
  private EnvironmentTagName: string;
  constructor(scope: Construct, id: string, props: AppApiStackProps) {
    console.log('Starting stack creation');
    super(scope, id, props);

    this.EnvironmentTagName = props.environment;
    const CoreStack = props.coreStack;

    const context = new MttContext(this, this.stackName, 'ApiV2', undefined, props.coreStack);
    // context.addStackLayer();
    console.info('Context created');

    const userPoolId = context.getParameter(`/${this.EnvironmentTagName}/regional/cognito/userpoolid`).stringValue;
    console.info('UserPool', userPoolId);
    const userPool = awscognito.UserPool.fromUserPoolId(this, 'CognitoUserPool', userPoolId);
    const cognito = MttCognito.fromUserPoolId(context, userPool, { id: 'CognitoUserPool', envVariable: 'UserPoolId' });

    const dataTableArn = Fn.importValue(`${CoreStack}-DynamoTableDataArn`);
    const primaryTableArn = Fn.importValue(`${CoreStack}-DynamoTablePrimaryArn`);
    const dataTable = MttDynamoDB.fromTableArn(context, { id: 'DynamoDataTable', name: 'DataTable', phi: true, identifiable: false }, dataTableArn);
    const primaryTable = MttDynamoDB.fromTableArn(context, { id: 'DynamoPrimaryTable', name: 'PrimaryTable', phi: true, identifiable: true }, primaryTableArn);
    const dataBucket = new MttS3(context, { id: 'DataBucket', stack: CoreStack, name: 'data', envName: 'dataBucket', existing: true, phi: true })
    const binBucket = MttS3.getExisting(
        context, 
        context.getParameter(`/${this.EnvironmentTagName}/regional/templates/bucket`).stringValue, 
        false, 
        'TemplateBucket');
        
    const timestreamArn = Fn.importValue(`${CoreStack}-timestream-data-arn`);
    const timestreamName = Fn.importValue(`${CoreStack}-timestream-name`);
    const timestream = MttTimestream.fromTableArn(context, timestreamArn, {
        tableName: timestreamName,
        envTable: 'timestreamDatabase',
        hasPhi: true
    });

    const appsync = AppSyncApi.fromProps(context, 'appsync', {
        appsyncArn: context.getCalcParameter(true, `web/appsync/arn`).stringValue,
        appsyncId: context.getCalcParameter(true, `web/appsync/id`).stringValue,
        appsyncUrl: context.getCalcParameter(true, `web/appsync/domain`).stringValue,
        envVariable: 'appsyncUrl'
    });

    const webDomain = context.getParameter(`/${this.EnvironmentTagName}/domain/sub/website/name`).stringValue;
    const domain = context.getParameter(`/${this.EnvironmentTagName}/domain/sub/api/name`).stringValue;
    const subdomain = context.getParameter(`/${this.EnvironmentTagName}/domain/sub/api/subdomain`).stringValue;
    const api = new MttRestApi(context, {
        id: 'ServerlessRestApi',
        name: `mytaptrack-api-${this.EnvironmentTagName}`,
        domain,
        subdomain,
        certificate: context.getParameter(`/${this.EnvironmentTagName}/domain/sub/api/cert`).stringValue,
        authentication: {
            cognito: cognito.userPool
        }
    });
    new ssm.StringParameter(this, 'PiiEncryptionArnParam', { 
        parameterName: `/${this.EnvironmentTagName}/regional/calc/api/domain`,
        stringValue: `${api.api.restApiName}.execute-api.${this.region}.amazonaws.com` })

    api.addLambdaHandler({
        id: 'browserErrorPost',
        codePath: 'src/v2/utils/browserError.ts',
        handler: 'handleEvent',
        path: '/api/user/error',
        method: 'post',
    });

    const appDetailsKey = `/${this.EnvironmentTagName}/app/detailsKey`;

    const AppTokenKey = new MttParameter(context, {
        name: `/${this.EnvironmentTagName}/app/tokenKey`,
        envVariable: 'TokenEncryptKey'
    });
    const AppDetailsKey = new MttParameter(context, {
        name: `/${this.EnvironmentTagName}/app/detailsKey`,
        envVariable: 'TokenEncryptDetails'
    });


    const stackReferenceName = `mytaptrack-api-${this.EnvironmentTagName}`;
    new ApiV2AppApi(this, 'AppApi', {
        ...props,
        apiSource: api,
        dataTable,
        primaryTable,
        cognito,
        applicationName: 'ApiV2',
        AppDetailsKey,
        AppTokenKey,
        parentStackName: stackReferenceName,
        appsync
    });

    new ApiV2LicenseApi(this, 'LicenseApi', {
        ...props,
        apiSource: api,
        dataTable,
        primaryTable,
        cognito,
        applicationName: 'ApiV2',
        timestream,
        parentStackName: stackReferenceName
    });

    new ApiV2ManageApi(this, 'ManageApi', {
        ...props,
        apiSource: api,
        dataTable,
        primaryTable,
        cognito,
        applicationName: 'ApiV2',
        timestream,
        appDetailsKey: AppDetailsKey,
        parentStackName: stackReferenceName,
        appsync
    });

    new ApiV2ReportApi(this, 'ReportApi', {
        ...props,
        apiSource: api,
        dataTable,
        primaryTable,
        cognito,
        applicationName: 'ApiV2',
        dataBucket,
        EnvironmentTagName: this.EnvironmentTagName,
        AppDetailsKey,
        AppTokenKey,
        parentStackName: stackReferenceName,
        appsync
    });

    new ApiV2StudentApi(this, 'StudentApi', {
        ...props,
        apiSource: api,
        dataTable,
        primaryTable,
        cognito,
        applicationName: 'ApiV2',
        dataBucket,
        binBucket,
        EnvironmentTagName: this.EnvironmentTagName,
        parentStackName: stackReferenceName,
        appsync
    });

    new ApiV2UserApi(this, 'UserApi', {
        ...props,
        apiSource: api,
        dataTable,
        primaryTable,
        cognito,
        applicationName: 'ApiV2',
        parentStackName: stackReferenceName
    });

    // Output the AppSync API endpoint
    new CfnOutput(this, 'AppSyncApiEndpoint', {
      value: api.api.url,
    });

    console.info('Stack outline complete');
  }

}
