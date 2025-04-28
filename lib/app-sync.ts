import { Fn, Stack, CfnOutput, Duration } from 'aws-cdk-lib';
import { Role, ManagedPolicy, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { AuthorizationType, Code, FieldLogLevel, FunctionRuntime, MappingTemplate, NoneDataSource } from 'aws-cdk-lib/aws-appsync';
import { ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { AppApiStackProps } from './params';
import { Construct } from 'constructs';
import { CfnParameter, StringParameter } from 'aws-cdk-lib/aws-ssm';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { 
  AppSyncApi, MttContext, AppsyncSchema, MttFunction, MttDynamoDB, DynamoDBAccess, 
  MttS3, MttSqs, SqsAccess, EventBusAccess, MttCognito, MttSecret, MTTSecretAccess, 
  CognitoAccess } from '@mytaptrack/cdk';
import { AccessLevel } from '@mytaptrack/types';
import { S3Access } from '@mytaptrack/cdk';
import { MttIndexes } from '@mytaptrack/lib/dist/v2/dals/dal';
import { MttEventType } from '@mytaptrack/lib';

export class AppSyncStack extends Stack {
  private EnvironmentTagName: string;
  constructor(scope: Construct, id: string, props: AppApiStackProps) {
    console.log('Starting stack creation');
    super(scope, id, props);

    this.EnvironmentTagName = props.environment;
    const CoreStack = props.coreStack;

    const context = new MttContext(this, this.stackName, 'AppSyncStack', undefined, props.coreStack);
    // context.addStackLayer();
    console.info('Context created');

    const userPoolId = StringParameter.valueForStringParameter(this, `/${this.EnvironmentTagName}/regional/cognito/userpoolid`);
    const userPool = UserPool.fromUserPoolId(this, 'CognitoUserPool', userPoolId);
    const cognito = MttCognito.fromUserPoolId(context, userPool, { 
      id: 'CognitoUserPool', 
      envVariable: 'UserPoolId' 
    });

    const dataTableArn = Fn.importValue(`${CoreStack}-DynamoTableDataArn`);
    const primaryTableArn = Fn.importValue(`${CoreStack}-DynamoTablePrimaryArn`);
    const dataTable = MttDynamoDB.fromTableArn(context, { id: 'DynamoDataTable', name: 'DataTable', phi: true, identifiable: false }, dataTableArn);
    const primaryTable = MttDynamoDB.fromTableArn(context, { id: 'DynamoPrimaryTable', name: 'PrimaryTable', phi: true, identifiable: true }, primaryTableArn);
    const dataBucket = new MttS3(context, { id: 'DataBucket', stack: CoreStack, name: 'data', envName: 'dataBucket', existing: true, phi: true });
    const timestreamArn = Fn.importValue(`${CoreStack}-timestream-data-arn`);
    const timestreamName = Fn.importValue(`${CoreStack}-timestream-name`);

    // AppSync CloudWatch Role
    const appsyncCloudwatchRole = new Role(this, 'AppsyncCloudwatchRole', {
      assumedBy: new ServicePrincipal('appsync.amazonaws.com'),
    });
    appsyncCloudwatchRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSAppSyncPushToCloudWatchLogs'));

    // AppSync GraphQL API
    const graphQLApi = new AppSyncApi(context, 'AppSyncEndpoint', {
      name: `${context.stackName}-appsync-endpoint`,
      envVariable: 'appsyncUrl',
      authorizationConfig: {
        defaultAuthorization: {
            authorizationType: AuthorizationType.USER_POOL,
            userPoolConfig: {
              userPool: cognito.userPool,
            }
        },
        additionalAuthorizationModes: [
            {
              authorizationType: AuthorizationType.IAM
            }
        ]
      },
      logConfig: {
        excludeVerboseContent: false,
        fieldLogLevel: FieldLogLevel.ALL,
      },
      schema: new AppsyncSchema({
        filePath: 'src/graphql/schema.graphql',
      })
    });

    // Parameter for AppSync API Endpoint
    new CfnParameter(this, 'ParamAppSyncApiEndpoint', {
      name: `/${this.EnvironmentTagName}/regional/calc/web/appsync/domain`,
      value: graphQLApi.graphqlUrl,
      type: 'String',
    });
    new CfnParameter(this, 'ParamAppSyncApiEndpointArn', {
      name: `/${this.EnvironmentTagName}/regional/calc/web/appsync/arn`,
      value: graphQLApi.arn!,
      type: 'String',
    });
    new CfnParameter(this, 'ParamAppSyncApiEndpointId', {
      name: `/${this.EnvironmentTagName}/regional/calc/web/appsync/id`,
      value: graphQLApi.apiId,
      type: 'String',
    });

    graphQLApi.addLambdaResolver('GetGlobalServiceReport', {
      id: 'GetGlobalServiceReport',
      codePath: 'src/graphql/resolver/query/getGlobalServiceReport/data.ts',
      handler: 'handler',
      typeName: 'Query',
      fieldName: 'getGlobalServiceReport',
      tables: [
        { table: primaryTable, access: DynamoDBAccess.read },
        { table: dataTable, access: DynamoDBAccess.read }
      ]
    });

    graphQLApi.addLambdaResolver('ResolverGetStudents', {
      id: 'ResolverGetStudents',
      typeName: 'Query',
      fieldName: 'getStudents',
      codePath: 'src/graphql/resolver/query/getStudent/get-students.ts',
      tables: [
        { table: primaryTable, access: DynamoDBAccess.read },
        { table: dataTable, access: DynamoDBAccess.read }
      ],
      auth: {
        student: {}
      }
    });

    graphQLApi.addLambdaResolver('FindStudent', {
      id: 'FindStudent',
      typeName: 'Query',
      fieldName: 'findStudent',
      codePath: 'src/graphql/resolver/query/getStudent/find-students.ts',
      tables: [
        { table: primaryTable, access: DynamoDBAccess.read },
        { table: dataTable, access: DynamoDBAccess.read, indexes: [ MttIndexes.license ] }
      ],
      auth: {
        license: true
      }
    });

    // TODO add back
    graphQLApi.addLambdaResolver('getLicenses', {
      id: 'GetLicenses',
      typeName: 'Query',
      fieldName: 'getLicenses',
      codePath: 'src/graphql/resolver/query/getLicenses/data.ts',
      tables: [{ table: dataTable, access: DynamoDBAccess.read }]
    });

    graphQLApi.addLambdaResolver('GetLicenseStats', {
      id: 'GetLicenseStats',
      typeName: 'Query',
      fieldName: 'getLicenseStats',
      codePath: 'src/graphql/resolver/query/getLicenses/stats.ts',
      environmentVariables: {
        timestreamDatabase: timestreamName
      },
      tables: [
        { table: dataTable, access: DynamoDBAccess.read, indexes: ['', MttIndexes.license ] }
      ],
      policyStatements: [
        {
          actions: [
            'timestream:DescribeEndpoints'
          ],
          resources: ['*']
        },
        {
          actions: [
            'timestream:Select'
          ],
          resources: [
            `${timestreamArn}`
          ]
        }
      ]
    });

    graphQLApi.addLambdaResolver('GetStudentData', {
      id: 'GetStudentData',
      codePath: 'src/graphql/resolver/query/getStudent/data.ts',
      typeName: 'Query',
      fieldName: 'getStudent',
      environmentVariables: {
        'STRONGLY_CONSISTENT_READ': 'true',
      },
      tables: [
        { table: primaryTable, access: DynamoDBAccess.read }, 
        { table: dataTable, access: DynamoDBAccess.read }
      ],
      auth: {
        student: {
          data: AccessLevel.read
        }
      }
    });

    const get_report_data = graphQLApi.addLambdaResolver('GetDataReport', {
      id: 'GetDataReport',
      codePath: 'src/graphql/resolver/query/getData/data.ts',
      typeName: 'Query',
      fieldName: 'getData',
      tables: [ 
        { table: dataTable, access: DynamoDBAccess.read },
        { table: primaryTable, access: DynamoDBAccess.read }
      ],
      auth: {
        student: {
          data: AccessLevel.read
        }
      }
    });

    graphQLApi.addLambdaResolver('GetNotes', {
      id: 'GetNotes',
      codePath: 'src/graphql/resolver/query/getData/notes.ts',
      typeName: 'Query',
      fieldName: 'getNotes',
      tables: [
        { table: dataTable, access: DynamoDBAccess.read },
        { table: primaryTable, access: DynamoDBAccess.read }
      ],
      buckets: [
        { bucket: dataBucket, access: S3Access.read, pattern: 'student/*' }
      ],
      auth: {
        student: {
          comments: AccessLevel.read
        }
      }
    });
    graphQLApi.addLambdaResolver('UpdateNotes', {
      id: 'UpdateNotes',
      codePath: 'src/graphql/resolver/mutations/report/notes.ts',
      typeName: 'Mutation',
      fieldName: 'updateNotes',
      tables: [
        { table: dataTable, access: DynamoDBAccess.read },
        { table: primaryTable, access: DynamoDBAccess.readWrite }
      ],
      auth: {
        student: {
          comments: AccessLevel.admin
        }
      }
    });
    graphQLApi.addLambdaResolver("OnStudentNote", {
      id: 'OnStudentNote',
      codePath: 'src/graphql/resolver/subscriptions/report/notes.ts',
      typeName: 'Subscription',
      fieldName: 'onStudentNote',
      tables: [
        { table: dataTable, access: DynamoDBAccess.read }
      ],
      auth: {
        student: {
          comments: AccessLevel.read
        }
      }
    });
    
    graphQLApi.addLambdaResolver('UpdateDateInclusion', {
      id: 'updateReportDateInclusion',
      codePath: 'src/graphql/resolver/mutations/report/date-inclusion.ts',
      typeName: 'Mutation',
      fieldName: 'updateReportDateInclusion',
      tables: [
        { table: dataTable, access: DynamoDBAccess.readWrite }
      ],
      auth: {
        student: {
          data: AccessLevel.admin
        }
      }
    });

    graphQLApi.addLambdaResolver('UpdateUserDashboard', {
      id: 'UpdateUserDashboard',
      codePath: 'src/graphql/resolver/mutations/user/dashboard.ts',
      typeName: 'Mutation',
      fieldName: 'updateUserBehaviorDashboardSettings',
      tables: [ 
        { table: dataTable, access: DynamoDBAccess.readWrite } 
      ],
      auth: {
        student: {
          data: AccessLevel.read
        }
      }
    });

    graphQLApi.addLambdaResolver('UpdateStudentData', {
      id: 'UpdateStudentData',
      codePath: 'src/graphql/resolver/mutations/student/update-info/data.ts',
      typeName: 'Mutation',
      fieldName: 'updateStudent',
      tables: [
        { table: primaryTable, access: DynamoDBAccess.readWrite }, 
        { table: dataTable, access: DynamoDBAccess.readWrite }
      ],
      auth: {
        student: {}
      }
    });

    graphQLApi.addLambdaResolver('DeleteStudents', {
      id: 'DeleteStudents',
      codePath: 'src/graphql/resolver/mutations/student/update-info/delete.ts',
      typeName: 'Mutation',
      fieldName: 'deleteStudent',
      environmentVariables: {
        STRONGLY_CONSISTENT_READ: 'true'
      },
      tables: [
        { table: primaryTable, access: DynamoDBAccess.readWrite }, 
        { table: dataTable, access: DynamoDBAccess.readWrite, indexes: [ '', MttIndexes.student, MttIndexes.license ] }
      ],
      auth: {
        student: {}
      }
    });

    graphQLApi.addLambdaResolver('GetDataSources', {
      id: 'GetDataSources',
      codePath: 'src/graphql/resolver/query/getStudent/data-sources.ts',
      typeName: 'Query',
      fieldName: 'getStudentSources',
      tables: [
        { table: primaryTable, access: DynamoDBAccess.read }, 
        { table: dataTable, access: DynamoDBAccess.read, indexes: ['', 'Student'] }
      ],
      auth: {
        student: {
        }
      }
    });

    graphQLApi.addLambdaResolver('ListSnapshots', {
      id: 'ListSnapshots',
      codePath: 'src/graphql/resolver/query/getSnapshot/list.ts',
      typeName: 'Query',
      fieldName: 'listSnapshots',
      tables: [
        { table: dataTable, access: DynamoDBAccess.read },
        { table: primaryTable, access: DynamoDBAccess.read }
      ],
      buckets: [
        { bucket: dataBucket, access: S3Access.read, pattern: 'student/*' }
      ],
      auth: {
        student: {
          reports: AccessLevel.read
        }
      }
    });

    graphQLApi.addLambdaResolver('GetSnapshot', {
      id: 'GetSnapshot',
      codePath: 'src/graphql/resolver/query/getSnapshot/get.ts',
      typeName: 'Query',
      fieldName: 'getSnapshot',
      tables: [
        { table: dataTable, access: DynamoDBAccess.read },
        { table: primaryTable, access: DynamoDBAccess.read }
      ],
      buckets: [
        { bucket: dataBucket, access: S3Access.read, pattern: 'student/*' }
      ],
      auth: {
        student: {
          reports: AccessLevel.read
        }
      }
    });

    graphQLApi.addLambdaResolver('SaveSnapshot', {
      id: 'SaveSnapshot',
      codePath: 'src/graphql/resolver/mutations/snapshot/save.ts',
      typeName: 'Mutation',
      fieldName: 'updateSnapshot',
      tables: [
        { table: dataTable, access: DynamoDBAccess.read }
      ],
      buckets: [
        { bucket: dataBucket, access: S3Access.write, pattern: 'student/*' }
      ],
      auth: {
        student: {
          reports: AccessLevel.admin
        }
      }
    });

    
    const reportDataQueue = new MttSqs(context, {
      id: 'ReportDataQueue',
      name: `${context.stackName}-${context.region}.fifo`,
      fifo: true,
      envVariable: 'DATA_QUEUE_URL',
      contentBasedDeduplication: true,
      hasPhi: true
    });

    graphQLApi.addLambdaResolver('UpdateDataInReport', {
      id: 'UpdateDataInReport',
      codePath: 'src/graphql/resolver/mutations/report/data.ts',
      typeName: 'Mutation',
      fieldName: 'updateDataInReport',
      environmentVariables: {
        EVENT_BUS: context.getEventBus().eventBusName
      },
      tables: [{ table: dataTable, access: DynamoDBAccess.read }],
      sqs: [{ sqs: reportDataQueue, access: SqsAccess.sendMessage}],
      auth: {
        student: {
          data: AccessLevel.admin
        }
      },
      policyStatements: [
        {
          actions: ['events:PutEvents'],
          resources: [`arn:aws:events:${context.region}:${this.account}:event-bus/*`]
        }
      ]
    });

    graphQLApi.addLambdaResolver('UpdateReportDaySchedule', {
      id: 'UpdateReportDaySchedule',
      codePath: 'src/graphql/resolver/mutations/report/schedule.ts',
      typeName: 'Mutation',
      fieldName: 'updateReportDaySchedule',
      environmentVariables: {
          STRONGLY_CONSISTENT_READ: 'true'
      },
      tables: [{ table: dataTable, access: DynamoDBAccess.readWrite }],
      auth: {
        student: {
          data: AccessLevel.admin
        }
      }
    });

    new MttFunction(context, {
      id: 'ProcessDataInReport',
      codePath: 'src/graphql/resolver/mutations/report/process.ts',
      tables: [
        { table: dataTable, access: DynamoDBAccess.readWrite, indexes: [ '', MttIndexes.student ] },
        { table: primaryTable, access: DynamoDBAccess.readWrite }
      ],
      sqs: [{ sqs: reportDataQueue, access: SqsAccess.subscribe}],
      environmentVariables: {
        'STRONGLY_CONSISTENT_READ': 'true',
        EVENT_BUS: context.getEventBus().eventBusName
      },
      policyStatements: [
        {
          actions: ['events:PutEvents'],
          resources: [`arn:aws:events:${context.region}:${this.account}:event-bus/*`]
        }
      ],
      appsync: [{ api: graphQLApi, access: { mutations: ['studentDataChange'] } }]
    });

    new MttFunction(context, {
      id: 'ReportQueueManagement',
      codePath: 'src/graphql/resolver/mutations/report/queue-management.ts',
      sqs: [{ sqs: reportDataQueue, access: SqsAccess.sendMessage }],
      events: [
        { detailType: [MttEventType.trackService, MttEventType.trackEvent], access: EventBusAccess.subscribe }
      ]
    });

    new MttFunction(context, {
      id: 'ReportReprocess',
      codePath: 'src/graphql/resolver/mutations/report/reprocess-events.ts',
      tables: [
        { table: dataTable, access: DynamoDBAccess.readWrite }
      ],
      sqs: [{ sqs: reportDataQueue, access: SqsAccess.sendMessage }],
      buckets: [{ bucket: dataBucket, access: S3Access.read, pattern: 'reprocess/*' }],
      environmentVariables: {
        appsyncUrl: graphQLApi.graphqlUrl
      },
      policyStatements: [
        {
          actions: ['appsync:GraphQL'],
          resources: ['*']
        }
      ]
    });

    graphQLApi.addLambdaResolver('DeleteNotifications', {
      id: 'DeleteNotifications',
      typeName: 'Mutation',
      fieldName: 'deleteNotifications',
      codePath: 'src/graphql/resolver/mutations/student/notifications/delete-notifications.ts',
      tables: [
        { table: dataTable, access: DynamoDBAccess.readWrite }
      ],
      auth: {
        student: {
          data: AccessLevel.read
        }
      }
    });

    graphQLApi.addLambdaResolver('GetAppList', {
      id: 'GetAppList',
      typeName: 'Query',
      fieldName: 'getAppList',
      codePath: 'src/graphql/resolver/query/getDevices/apps.ts',
      environmentVariables: {
        'STRONGLY_CONSISTENT_READ': 'true'
      },
      tables: [
        { table: primaryTable, access: DynamoDBAccess.read },
        { table: dataTable, access: DynamoDBAccess.read }
      ],
      auth: {
        license: true
      }
    });

    graphQLApi.addLambdaResolver('GetApp', {
      id: 'GetApp',
      typeName: 'Query',
      fieldName: 'getApp',
      codePath: 'src/graphql/resolver/query/getDevices/app.ts',
      tables: [
        { table: primaryTable, access: DynamoDBAccess.readWrite },
        { table: dataTable, access: DynamoDBAccess.read, indexes: [ '', MttIndexes.device ] }
      ],
      auth: {
        license: true
      }
    });

    const encToken = context.getParameter(`/${props.environment}/app/secrets/tokenKey/name`);
    graphQLApi.addLambdaResolver('GetAppToken', {
      id: 'GetAppToken',
      typeName: 'Query',
      fieldName: 'getAppToken',
      codePath: 'src/graphql/resolver/query/getDevices/appToken.ts',
      environmentVariables: {
        TokenEncryptKey: encToken.stringValue,
        appid: context.getParameter(`/${props.environment}/domain/sub/device/appid`).stringValue
      },
      tables: [
        { table: dataTable, access: DynamoDBAccess.read }
      ],
      policyStatements: [
        {
          effect: Effect.ALLOW,
          actions: ['ssm:GetParameter'],
          resources: ['*']
        }
      ]
    });

    graphQLApi.addLambdaResolver('GetAppsForDevice', {
      id: 'GetAppsForDevice',
      typeName: 'Query',
      fieldName: 'getAppsForDevice',
      codePath: 'src/graphql/resolver/query/getDevices/apps-for-device.ts',
      environmentVariables: {
        STRONGLY_CONSISTENT_READ: 'true'
      },
      tables: [
        { table: primaryTable, access: DynamoDBAccess.readWrite },
        { table: dataTable, access: DynamoDBAccess.readWrite, indexes: [ '', MttIndexes.device ] }
      ]
    });
    graphQLApi.addLambdaResolver('GetAppsForLicense', {
      id: 'GetAppsForLicense',
      typeName: 'Query',
      fieldName: 'getAppsForLicense',
      codePath: 'src/graphql/resolver/query/getDevices/apps-for-license.ts',
      tables: [
        { table: primaryTable, access: DynamoDBAccess.readWrite },
        { table: dataTable, access: DynamoDBAccess.readWrite, indexes: [ '', MttIndexes.device ] }
      ]
    });

    graphQLApi.addLambdaResolver('getTrackForDevice', {
      id: 'GetTrackForDevice',
      typeName: 'Query',
      fieldName: 'getTrackForDevice',
      codePath: 'src/graphql/resolver/query/getDevices/track-for-dsn.ts',
      tables: [
        { table: primaryTable, access: DynamoDBAccess.readWrite },
        { table: dataTable, access: DynamoDBAccess.readWrite, indexes: [ '', MttIndexes.device ] }
      ]
    });

    graphQLApi.addLambdaResolver('UpdateApp', {
      id: 'UpdateApp',
      typeName: 'Mutation',
      fieldName: 'updateApp',
      codePath: 'src/graphql/resolver/mutations/app/update.ts',
      tables: [
        { table: primaryTable, access: DynamoDBAccess.readWrite },
        { table: dataTable, access: DynamoDBAccess.readWrite, indexes: [ '', MttIndexes.device ] }
      ],
      auth: {
        license: true
      }
    });

    graphQLApi.addLambdaResolver('GetSubscriptionsForStudent', {
      id: 'GetSubscriptionsForStudent',
      typeName: 'Query',
      fieldName: 'getSubscriptionsForStudent',
      codePath: 'src/graphql/resolver/query/getStudent/subscriptions.ts',
      tables: [
        { table: primaryTable, access: DynamoDBAccess.read },
        { table: dataTable, access: DynamoDBAccess.read, indexes: [ '', MttIndexes.device ] }
      ],
      auth: {
        student: {
          notifications: AccessLevel.read
        }
      }
    });

    graphQLApi.addLambdaResolver('GetUsersForLicense', {
      id: 'GetUsersForLicense',
      typeName: 'Query',
      fieldName: 'getUsersForLicense',
      codePath: 'src/graphql/resolver/query/getUsers/manage.ts',
      environmentVariables: {
        STRONGLY_CONSISTENT_READ: 'true'
      },
      tables: [
        { table: primaryTable, access: DynamoDBAccess.read },
        { table: dataTable, access: DynamoDBAccess.read, indexes: [ '', MttIndexes.license ] }
      ],
      auth: {
        license: true
      }
    });

    graphQLApi.addLambdaResolver('GetServerSettings', {
      id: 'GetServerSettings',
      typeName: 'Query',
      fieldName: 'getServerSettings',
      codePath: 'src/graphql/resolver/query/getServerSettings/data.ts',
      environmentVariables: {
        'https': context.getParameter(`/${props.environment}/domain/sub/device/name`).stringValue,
        'apikey': context.getParameter(`/${props.environment}/domain/sub/device/apikey`).stringValue,
        'graphql': graphQLApi.graphqlUrl,
        appid: context.getParameter(`/${props.environment}/domain/sub/device/appid`).stringValue
      },
      auth: {
        license: true
      }
    });

    graphQLApi.addLambdaResolver('GetUser', {
      id: 'GetUser',
      typeName: 'Query',
      fieldName: 'getUser',
      codePath: 'src/graphql/resolver/query/getUsers/current.ts',
      tables: [
        { table: primaryTable, access: DynamoDBAccess.read },
        { table: dataTable, access: DynamoDBAccess.read }
      ],
      cognito: [ { pool: cognito, access: CognitoAccess.administrateUsers }]
    });
    graphQLApi.addLambdaResolver('AcceptUserTerms', {
      id: 'AcceptUserTerms',
      typeName: 'Mutation',
      fieldName: 'acceptUserTerms',
      codePath: 'src/graphql/resolver/mutations/user/accept-terms.ts',
      tables: [
        { table: dataTable, access: DynamoDBAccess.readWrite }
      ]
    });

    const stripeSecret = MttSecret.fromName(context, `${this.EnvironmentTagName}/stripe`, 'stripeSecret');
    graphQLApi.addLambdaResolver('GetUserPaymentSession', {
      id: 'GetUserPaymentSession',
      typeName: 'Query',
      fieldName: 'getUserPaymentSession',
      codePath: 'src/graphql/resolver/query/getUsers/payment-session.ts',
      tables: [
        { table: dataTable, access: DynamoDBAccess.read }
      ],
      secrets: [{ secret: stripeSecret, access: MTTSecretAccess.read }]
    });

    graphQLApi.addLambdaResolver('UpdateUser', {
      id: 'UpdateUser',
      typeName: 'Mutation',
      fieldName: 'updateUser',
      codePath: 'src/graphql/resolver/mutations/user/info.ts',
      tables: [
        { table: primaryTable, access: DynamoDBAccess.readWrite },
        { table: dataTable, access: DynamoDBAccess.readWrite }
      ],
      policyStatements: [
        {
          actions: ['cognito-idp:ListUsers'],
          resources: [cognito.userPool.userPoolArn]
        }
      ],
      environmentVariables: {
        UserPoolId: userPoolId
      }
    });

    graphQLApi.addLambdaResolver('GetFreeLicense', {
      id: 'GetFreeLicense',
      typeName: 'Mutation',
      fieldName: 'getFreeLicense',
      codePath: 'src/graphql/resolver/mutations/license/free-license.ts',
      tables: [
        { table: primaryTable, access: DynamoDBAccess.readWrite },
        { table: dataTable, access: DynamoDBAccess.readWrite }
      ],
      cognito: [{ pool: cognito, access: CognitoAccess.administrateGroups }], 
      environmentVariables: {
        UserPoolId: userPoolId
      },
      appsync: [{ api: graphQLApi, access: { mutations: ['userLicenseChange']} }]
    });

    graphQLApi.addLambdaResolver('userLicenseChange', {
      id: 'userLicenseChange',
      typeName: 'Mutation',
      fieldName: 'userLicenseChange',
      codePath: 'src/graphql/resolver/mutations/license/license-updated.ts',
      environmentVariables: {
        STRONGLY_CONSISTENT_READ: 'true'
      },
      tables: [
        { table: primaryTable, access: DynamoDBAccess.readWrite },
        { table: dataTable, access: DynamoDBAccess.readWrite }
      ]
    });

    graphQLApi.addLambdaResolver('ChangeLicense', {
      id: 'ChangeLicense',
      typeName: 'Mutation',
      fieldName: 'changeLicense',
      codePath: 'src/graphql/resolver/mutations/license/change-license.ts',
      tables: [
        { table: primaryTable, access: DynamoDBAccess.readWrite, indexes: ['', MttIndexes.license ] },
        { table: dataTable, access: DynamoDBAccess.readWrite, indexes: ['', MttIndexes.license ] }
      ],
      cognito: [{ pool: cognito, access: CognitoAccess.administrateGroups }], 
      environmentVariables: {
        UserPoolId: userPoolId
      },
      secrets: [{ secret: stripeSecret, access: MTTSecretAccess.read }],
      appsync: [{ api: graphQLApi, access: { mutations: ['userLicenseChange']} }]
    });

    const noneSource = graphQLApi.addNoneDataSource('NoneDataSource', {
      name: 'NoneDataSource',
      description: 'NoneDataSource'
    });
    graphQLApi.createResolver('onUserLicenseChange', {
      typeName: 'Subscription',
      fieldName: 'onUserLicenseChange',
      code: Code.fromAsset('./src/graphql/resolver/authorization/user-id-match.js'),
      runtime: FunctionRuntime.JS_1_0_0,
      dataSource: noneSource
    });

    graphQLApi.createResolver('userStudentAccessSubCheck', {
      typeName: 'Subscription',
      fieldName: 'onStudentDataChange',
      code: Code.fromAsset('./src/graphql/resolver/authorization/user-id-match.js'),
      runtime: FunctionRuntime.JS_1_0_0,
      dataSource: noneSource
    });

    graphQLApi.createResolver('studentDataChange', {
      typeName: 'Mutation',
      fieldName: 'studentDataChange',
      code: Code.fromAsset('./src/graphql/resolver/mutations/passthrough.js'),
      runtime: FunctionRuntime.JS_1_0_0,
      dataSource: noneSource
    });

    graphQLApi.addLambdaResolver('emailSupport', {
      id: 'emailSupport',
      typeName: 'Mutation',
      fieldName: 'emailSupport',
      codePath: './src/graphql/resolver/mutations/support/email.ts',
      sendEmail: true,
      environmentVariables: {
          TemplatePath: 'mytaptrack/templates',
          SystemEmail: context.getParameter(`/${props.environment}/system/email`).stringValue
      },
      tables: [
        { table: primaryTable, access: DynamoDBAccess.read }
      ]
    });

    graphQLApi.addLambdaResolver('updateInvite', {
      id: 'updateInvite',
      typeName: 'Mutation',
      fieldName: 'updateInvite',
      codePath: './src/graphql/resolver/mutations/user/invite.ts',
      tables: [
        { table: dataTable, access: DynamoDBAccess.readWrite },
        { table: primaryTable, access: DynamoDBAccess.read }
      ]
    });

    // const get_student_device_collection = graphQLApi.addLambdaResolver('GetStudentDeviceCollection', {
    //   id: 'GetStudentDeviceCollection',
    //   codePath: 'src/graphql/resolver/query/getDevices/devices.ts',
    //   typeName: 'Query',
    //   fieldName: 'getStudentDevices',
    //   tables: [
    //     { table: primaryTable, access: DynamoDBAccess.readWrite }, 
    //     { table: dataTable, access: DynamoDBAccess.readWrite }
    //   ]
    // });

    // # ResolverGetServiceStudentsFunction:
    // #   Type: AWS::AppSync::FunctionConfiguration
    // #   Properties:
    // #     ApiId: !GetAtt AppSyncEndpoint.ApiId
    // #     Name: current_user_service_students
    // #     Description: Gets the service students the current user has access to
    // #     DataSourceName: !GetAtt GraphQLDataSourceData.Name
    // #     FunctionVersion: "2018-05-29"
    // #     Runtime:
    // #       Name: APPSYNC_JS
    // #       RuntimeVersion: '1.0.0'
    // #     CodeS3Location: ./src/graphql/resolver/query/getStudents/data.ts
    // # ResolverGetServiceStudents:
    // #   Type: AWS::AppSync::Resolver
    // #   DependsOn: GraphQLApiSchema
    // #   Properties:
    // #     ApiId: !GetAtt AppSyncEndpoint.ApiId
    // #     TypeName: Query
    // #     FieldName: getStudents
    // #     Kind: PIPELINE
    // #     PipelineConfig:
    // #       Functions:
    // #         - !GetAtt ResolverGetServiceStudentsFunction.FunctionId
    // #     RequestMappingTemplate: |
    // #       { }
    // #     ResponseMappingTemplate: |
    // #       $util.toJson($ctx.result)

    // const getServiceStudentsFunction = new AppsyncFunction(this, 'ResolverGetServiceStudentsFunction', {
    //     api: graphQLApi,
    //     name: 'get_students_data',
    //     description: 'Gets the service students the current user has access to',
    //     dataSource: graphQLDataSourceData,
    //     code: Code.fromAsset('src/graphql/resolver/query/getStudents/data.ts', { }),
    //     runtime: FunctionRuntime.JS_1_0_0,
    // });


    // Add more resolvers...

    new MttFunction(context, {
      id: 'cr-team-upgrade-1',
      codePath: 'src/migration/migrateTeam.ts',
      timeout: Duration.minutes(15),
      customResourceHandlers: {
        create: 'onCreate'
      },
      tables: [{ table: dataTable, access: DynamoDBAccess.readWrite }]
    });
    new MttFunction(context, {
      id: 'cr-notes-1',
      codePath: 'src/migration/migrateNotes.ts',
      timeout: Duration.minutes(15),
      customResourceHandlers: {
        create: 'onCreate'
      },
      tables: [
        { table: dataTable, access: DynamoDBAccess.read },
        { table: primaryTable, access: DynamoDBAccess.readWrite }
      ],
      buckets: [
        { bucket: dataBucket, access: S3Access.read }
      ]
    });

    new MttFunction(context, {
      id: 'cr-apps-migrate',
      codePath: 'src/migration/migrateApps.ts',
      timeout: Duration.minutes(15),
      customResourceHandlers: {
        create: 'onCreate'
      },
      tables: [
        { table: dataTable, access: DynamoDBAccess.readWrite },
        { table: primaryTable, access: DynamoDBAccess.readWrite }
      ],
    });
    new MttFunction(context, {
      id: 'cr-msources',
      codePath: 'src/migration/migrateSources.ts',
      timeout: Duration.minutes(15),
      customResourceHandlers: {
        create: 'onCreate'
      },
      tables: [{ table: dataTable, access: DynamoDBAccess.readWrite }],
    });
    new MttFunction(context, {
      id: 'cr-reports-update',
      codePath: 'src/migration/migrateReports.ts',
      timeout: Duration.minutes(15),
      customResourceHandlers: {
        create: 'onCreate'
      },
      tables: [{ table: dataTable, access: DynamoDBAccess.readWrite }],
    });

    // Output the AppSync API endpoint
    new CfnOutput(this, 'AppSyncApiEndpoint', {
      value: graphQLApi.graphqlUrl,
    });

    console.info('Stack outline complete');
  }
}
