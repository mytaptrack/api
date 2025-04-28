import { Duration, NestedStack, NestedStackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { AppApiStackProps } from "../params";
import { AppSyncApi, CognitoAccess, DynamoDBAccess, EventBusAccess, MttCognito, MttContext, MttDynamoDB, MttFunction, MttParameter, MttParameterAccess, MttRestApi, MttS3, MttSqs, MttTimestream, S3Access, SqsAccess } from "@mytaptrack/cdk";
import { MttEventType } from "@mytaptrack/lib";
import { MttIndexes } from "@mytaptrack/lib/dist/v2/dals/dal";
import { Effect } from "aws-cdk-lib/aws-iam";

export interface AppV2ReportApiStackProps extends NestedStackProps {
    apiSource: MttRestApi,
    dataTable: MttDynamoDB,
    primaryTable: MttDynamoDB,
    cognito: MttCognito,
    applicationName: string;
    AppTokenKey: MttParameter;
    AppDetailsKey: MttParameter;
    dataBucket: MttS3;
    EnvironmentTagName: string;
    parentStackName: string;
    coreStack: string;
    appsync: AppSyncApi;
}

export class ApiV2ReportApi extends NestedStack {
    constructor(scope: Construct, id: string, props: AppV2ReportApiStackProps) {
        super(scope, id, props);
        const { apiSource, dataTable, primaryTable, cognito, AppTokenKey, AppDetailsKey, dataBucket, EnvironmentTagName } = props;
        const context = new MttContext(this, `${props.parentStackName}-report`, props.applicationName, undefined, props.coreStack)
        const api = new MttRestApi(context, apiSource);

        api.addLambdaHandler({
            id: 'reportSnapshotGetV2',
            codePath: 'src/v2/reports/snapshot/get.ts',
            handler: 'handleEvent',
            path: '/api/v2/reports/snapshot',
            method: 'get',
            tables: [
                { table: dataTable, access: DynamoDBAccess.read },
                { table: primaryTable, access: DynamoDBAccess.read }
            ],
            buckets: [
                { bucket: dataBucket, access: S3Access.read, pattern: 'student/*' }
            ]
        });
    
        api.addLambdaHandler({
            id: 'reportSnapshotPostV2',
            codePath: 'src/v2/reports/snapshot/post.ts',
            handler: 'handleEvent',
            path: '/api/v2/reports/snapshot',
            method: 'post',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.read }
            ],
            buckets: [
                { bucket: dataBucket, access: S3Access.read, pattern: 'student/*' }
            ],
            appsync: [ { api: props.appsync, access: { queries: ['getSnapshot'] }}]
        });
    
        api.addLambdaHandler({
            id: 'reportSnapshotPut',
            codePath: 'src/v2/reports/snapshot/put.ts',
            handler: 'handleEvent',
            path: '/api/v2/reports/snapshot',
            method: 'put',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite }
            ],
            buckets: [
                { bucket: dataBucket, access: S3Access.write, pattern: 'student/*' }
            ]
        });
    
        api.addLambdaHandler({
            id: 'reportSettingsPut',
            codePath: 'src/v2/reports/settings/put.ts',
            handler: 'handleEvent',
            path: '/api/v2/reports/settings',
            method: 'put',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite }
            ]
        });
        api.addLambdaHandler({
            id: 'reportSettingsGet',
            codePath: 'src/v2/reports/settings/get.ts',
            handler: 'handleEvent',
            path: '/api/v2/reports/settings',
            method: 'get',
            tables: [
                { table: dataTable, access: DynamoDBAccess.read }
            ],
            appsync: [ { api: props.appsync, access: { queries: ['getStudent'] }}]
        });
    
        api.addLambdaHandler({
            id: 'reportDataGetV2',
            codePath: 'src/v2/reports/data/get.ts',
            handler: 'handleEvent',
            path: '/api/v2/reports/data',
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
            id: 'reportDataStateGetV2',
            codePath: 'src/v2/reports/data/statusGet.ts',
            handler: 'handleEvent',
            path: '/api/v2/reports/data/status',
            method: 'get',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
    
        api.addLambdaHandler({
            id: 'reportDataPutV2',
            codePath: 'src/v2/reports/data/put.ts',
            handler: 'handleEvent',
            path: '/api/v2/reports/data',
            method: 'put',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ],
            appsync: [ { api: props.appsync, access: { mutations: ['updateDataInReport'] }}]
        });
        api.addLambdaHandler({
            id: 'reportDataDeleteV2',
            codePath: 'src/v2/reports/data/delete.ts',
            handler: 'handleEvent',
            path: '/api/v2/reports/data',
            method: 'delete',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ],
            appsync: [ { api: props.appsync, access: { mutations: ['updateDataInReport'] }}]
        });
    
        api.addLambdaHandler({
            id: 'reportDataIntervalPutV2',
            codePath: 'src/v2/reports/data/intervalExclude.ts',
            handler: 'handleEvent',
            path: '/api/v2/reports/data/interval',
            method: 'put',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite }
            ]
        });
    
        api.addLambdaHandler({
            id: 'reportDataDatePutV2',
            codePath: 'src/v2/reports/date/put.ts',
            handler: 'handleEvent',
            path: '/api/v2/reports/data/date',
            method: 'put',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.read }
            ]
        });
    
        api.addLambdaHandler({
            id: 'notesPutV2',
            codePath: 'src/v2/reports/notes/put.ts',
            handler: 'handleEvent',
            path: '/api/v2/reports/notes',
            method: 'put',
            tables: [
                { table: dataTable, access: DynamoDBAccess.read }
            ],
            buckets: [{ bucket: dataBucket, access: S3Access.write, pattern: 'student/*'}],
            policyStatements: [
                {
                    effect: Effect.ALLOW,
                    resources: ['*'],
                    actions: ['ssm:GetParameter']
                }
            ]
        });
    
        api.addLambdaHandler({
            id: 'notesPostV2',
            codePath: 'src/v2/reports/notes/post.ts',
            handler: 'handleEvent',
            path: '/api/v2/reports/notes',
            method: 'post',
            tables: [
                { table: dataTable, access: DynamoDBAccess.read }
            ],
            buckets: [{ bucket: dataBucket, access: S3Access.read, pattern: 'student/*'}]
        });
    
        api.addLambdaHandler({
            id: 'scheduleOverwritePutV2',
            codePath: 'src/v2/reports/schedule/put.ts',
            handler: 'handleEvent',
            path: '/api/v2/reports/schedule',
            method: 'put',
            environmentVariables: {
                STRONGLY_CONSISTENT_READ: 'true'
            },
            tables: [
                { table: dataTable, access: DynamoDBAccess.read }
            ],
            appsync: [ { api: props.appsync, access: { mutations: ['updateReportDaySchedule'] }}]
        });
    
        api.addLambdaHandler({
            id: 'scheduleOverwriteDeleteV2',
            codePath: 'src/v2/reports/schedule/delete.ts',
            handler: 'handleEvent',
            path: '/api/v2/reports/schedule',
            method: 'delete',
            tables: [
                { table: dataTable, access: DynamoDBAccess.read }
            ],
            appsync: [ { api: props.appsync, access: { mutations: ['updateReportDaySchedule'] }}]
        });
    
    }
}