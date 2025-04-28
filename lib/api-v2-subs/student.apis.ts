import { Duration, NestedStack, NestedStackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { AppSyncApi, CognitoAccess, DynamoDBAccess, MttCognito, MttContext, MttDynamoDB, MttFunction, MttParameter, MttParameterAccess, MttRestApi, MttS3, MttSqs, MttTimestream, S3Access, SqsAccess } from "@mytaptrack/cdk";
import { MttIndexes } from "@mytaptrack/lib/dist/v2/dals/dal";

export interface AppStudentApiStackProps extends NestedStackProps {
    apiSource: MttRestApi,
    dataTable: MttDynamoDB,
    primaryTable: MttDynamoDB,
    cognito: MttCognito,
    applicationName: string;
    dataBucket: MttS3;
    binBucket: MttS3;
    EnvironmentTagName: string;
    parentStackName: string;
    coreStack: string;
    appsync: AppSyncApi
}

export class ApiV2StudentApi extends NestedStack {
    constructor(scope: Construct, id: string, props: AppStudentApiStackProps) {
        super(scope, id, props);
        const { apiSource, dataTable, primaryTable, cognito, dataBucket, EnvironmentTagName} = props;
        const context = new MttContext(this, `${props.parentStackName}-student`, props.applicationName, undefined, props.coreStack)
        const api = new MttRestApi(context, apiSource);

        // Student APIs
        api.addLambdaHandler({
            id: 'createPutV2',
            codePath: 'src/v2/student/info/put.ts',
            handler: 'handleEvent',
            path: '/api/v2/student',
            method: 'put',
            environmentVariables: {
                STRONGLY_CONSISTENT_READ: 'true'
            },
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite, indexes: ['', 'License'] },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });

        api.addLambdaHandler({
            id: 'getV2',
            codePath: 'src/v2/student/info/get.ts',
            handler: 'handleEvent',
            path: '/api/v2/student',
            method: 'get',
            environmentVariables: {
                STRONGLY_CONSISTENT_READ: 'true'
            },
            tables: [
                { table: dataTable, access: DynamoDBAccess.read },
                { table: primaryTable, access: DynamoDBAccess.read }
            ]
        });
        api.addLambdaHandler({
            id: 'documentGet',
            codePath: 'src/v2/student/documents/get.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/document',
            method: 'get',
            tables: [{ table: dataTable, access: DynamoDBAccess.read }],
            buckets: [{ bucket: dataBucket, access: S3Access.read, pattern: 'student/*'}]
        });
        api.addLambdaHandler({
            id: 'documentPut',
            codePath: 'src/v2/student/documents/put.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/document',
            method: 'put',
            tables: [{ table: dataTable, access: DynamoDBAccess.readWrite }],
            buckets: [{ bucket: dataBucket, access: S3Access.write, pattern: 'student/*'}]
        });
        api.addLambdaHandler({
            id: 'documentDelete',
            codePath: 'src/v2/student/documents/delete.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/document',
            method: 'delete',
            tables: [{ table: dataTable, access: DynamoDBAccess.readWrite }],
            buckets: [{ bucket: dataBucket, access: S3Access.write, pattern: 'student/*'}]
        });


        api.addLambdaHandler({
            id: 'subscriptionsGet',
            codePath: 'src/v2/student/subscriptions/get.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/subscriptions',
            method: 'get',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
        api.addLambdaHandler({
            id: 'subscriptionsPut',
            codePath: 'src/v2/student/subscriptions/put.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/subscriptions',
            method: 'put',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
    
        api.addLambdaHandler({
            id: 'notificationsGetV2',
            codePath: 'src/v2/student/notification/get.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/notification',
            method: 'get',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite }
            ]
        });
    
        const notificationDeleteQueue = new MttSqs(context, {
            id: 'notificationsDeleteQueue',
            name: `${EnvironmentTagName}-student-notifications-delete-queue.fifo`,
            fifo: true,
            kmsKey: context.kmsKey,
            retentionPeriod: Duration.seconds(900),
            visibilityTimeout: Duration.seconds(30),
            envVariable: 'NOTIFICATION_DELETE_QUEUE',
            contentBasedDeduplication: true,
            hasPhi: false
        });
    
        api.addLambdaHandler({
            id: 'notificationsDeleteV2',
            codePath: 'src/v2/student/notification/delete.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/notification',
            method: 'delete',
            tables: [
                { table: dataTable, access: DynamoDBAccess.read }
            ],
            sqs: [
                { sqs: notificationDeleteQueue, access: SqsAccess.sendMessage }
            ]
        });
    
        new MttFunction(context, {
            id: 'notifyDeleteProcV2',
            codePath: 'src/v2/student/notification/delete-processing.ts',
            handler: 'handleEvent',
            timeout: Duration.seconds(30),
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite }
            ],
            sqs: [ { sqs: notificationDeleteQueue, access: SqsAccess.subscribe }]
        });
    
        api.addLambdaHandler({
            id: 'behaviorPutV2',
            codePath: 'src/v2/student/behavior/put.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/behavior',
            method: 'put',
            environmentVariables: {
                STRONGLY_CONSISTENT_READ: 'true'
            },
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ],
            appsync: [ { api: props.appsync, access: { queries: ['getStudent'], mutations: ['updateStudent']}}]
        });
    
        api.addLambdaHandler({
            id: 'behaviorDeleteV2',
            codePath: 'src/v2/student/behavior/delete.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/behavior',
            method: 'delete',
            environmentVariables: {
                STRONGLY_CONSISTENT_READ: 'true'
            },
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
    
        api.addLambdaHandler({
            id: 'responsePutV2',
            codePath: 'src/v2/student/response/put.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/response',
            method: 'put',
            environmentVariables: {
                STRONGLY_CONSISTENT_READ: 'true'
            },
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
        api.addLambdaHandler({
            id: 'responseDeleteV2',
            codePath: 'src/v2/student/response/delete.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/response',
            method: 'delete',
            environmentVariables: {
                STRONGLY_CONSISTENT_READ: 'true'
            },
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
    
        api.addLambdaHandler({
            id: 'studentAbcPutV2',
            codePath: 'src/v2/student/abc/put.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/abc',
            method: 'put',
            environmentVariables: {
                STRONGLY_CONSISTENT_READ: 'true'
            },
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
        api.addLambdaHandler({
            id: 'studentAbcDeleteV2',
            codePath: 'src/v2/student/abc/delete.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/abc',
            method: 'delete',
            environmentVariables: {
                STRONGLY_CONSISTENT_READ: 'true'
            },
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
    
        api.addLambdaHandler({
            id: 'teamGetV2',
            codePath: 'src/v2/student/team/get.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/team',
            method: 'get',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite, indexes: ['', MttIndexes.student ] },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
    
        console.log('EnvironmentTagName', EnvironmentTagName);
        const templatePath = context.getParameter(`/${EnvironmentTagName}/regional/templates/path`).stringValue;
        api.addLambdaHandler({
            id: 'teamPutV2',
            codePath: 'src/v2/student/team/put.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/team',
            method: 'put',
            environmentVariables: {
                TemplatePath: 'mytaptrack/templates',
                SystemEmail: context.getParameter(`/${EnvironmentTagName}/system/email`).stringValue
            },
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ],
            cognito: [{ pool: cognito, access: CognitoAccess.listUsers }],
            buckets: [
                { bucket: dataBucket, access: S3Access.read, pattern: `${templatePath}/*`},
                { bucket: props.binBucket, access: S3Access.read }
            ],
            sendEmail: true
        });
        api.addLambdaHandler({
            id: 'teamPostV2',
            codePath: 'src/v2/student/team/post.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/team',
            method: 'post',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ],
            buckets: [{ bucket: props.binBucket, access: S3Access.read }],
            cognito: [{ pool: cognito, access: CognitoAccess.listUsers }],
        });
        api.addLambdaHandler({
            id: 'teamDeleteV2',
            codePath: 'src/v2/student/team/delete.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/team',
            method: 'delete',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
    
        api.addLambdaHandler({
            id: 'schedulesGetV2',
            codePath: 'src/v2/student/schedule/get.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/schedules',
            method: 'get',
            tables: [
                { table: dataTable, access: DynamoDBAccess.read },
                { table: primaryTable, access: DynamoDBAccess.read }
            ]
        });
        api.addLambdaHandler({
            id: 'schedulePutV2',
            codePath: 'src/v2/student/schedule/put.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/schedule',
            method: 'put',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
        api.addLambdaHandler({
            id: 'scheduleDeleteV2',
            codePath: 'src/v2/student/schedule/delete.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/schedule',
            method: 'delete',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
    }
}