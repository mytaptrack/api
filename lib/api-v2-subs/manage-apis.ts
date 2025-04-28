import { NestedStack, NestedStackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { AppApiStackProps } from "../params";
import { AppSyncApi, CognitoAccess, DynamoDBAccess, MttCognito, MttContext, MttDynamoDB, MttParameter, MttParameterAccess, MttRestApi, MttS3, MttTimestream, MttTimestreamAccess } from "@mytaptrack/cdk";
import { MttIndexes } from "@mytaptrack/lib/dist/v2/dals/dal";

export interface AppManageApiStackProps extends NestedStackProps {
    apiSource: MttRestApi;
    dataTable: MttDynamoDB;
    primaryTable: MttDynamoDB;
    cognito: MttCognito;
    applicationName: string;
    timestream: MttTimestream;
    appDetailsKey: MttParameter;
    parentStackName: string;
    coreStack: string;
    appsync: AppSyncApi;
}

export class ApiV2ManageApi extends NestedStack {
    constructor(scope: Construct, id: string, props: AppManageApiStackProps) {
        super(scope, id, props);
        const { apiSource, dataTable, primaryTable, cognito, timestream, appDetailsKey } = props;
        const context = new MttContext(this, `${props.parentStackName}-mng`, props.applicationName, undefined, props.coreStack)
        const api = new MttRestApi(context, apiSource);

        api.addLambdaHandler({
            id: 'manageStatsGetV2',
            codePath: 'src/v2/manage/license/statsGet.ts',
            handler: 'handleEvent',
            path: '/api/v2/manage/stats',
            method: 'get',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite, indexes: ['', 'License'] },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ],
            timestream: [{ table: timestream, access: MttTimestreamAccess.read }],
            ssm: [{ param: appDetailsKey, access: MttParameterAccess.read }]
        });
    
        api.addLambdaHandler({
            id: 'manageLicenseGetV2',
            codePath: 'src/v2/manage/license/get.ts',
            handler: 'handleEvent',
            path: '/api/v2/license',
            method: 'get',
            tables: [
                { table: dataTable, access: DynamoDBAccess.read },
                { table: primaryTable, access: DynamoDBAccess.read }
            ]
        });
    
        api.addLambdaHandler({
            id: 'manageLicenseStudentPutV2',
            codePath: 'src/v2/manage/license/studentPut.ts',
            handler: 'handleEvent',
            path: '/api/v2/license/student',
            method: 'put',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite, indexes: ['', 'License'] },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
    
        api.addLambdaHandler({
            id: 'manageAbcPutV2',
            codePath: 'src/v2/manage/abc/put.ts',
            handler: 'handleEvent',
            path: '/api/v2/manage/abc',
            method: 'put',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ],
            ssm: [{ param: appDetailsKey, access: MttParameterAccess.read }]
        });
    
        api.addLambdaHandler({
            id: 'manageAppsGetV2',
            codePath: 'src/v2/manage/app/appsGet.ts',
            handler: 'handleEvent',
            path: '/api/v2/manage/apps',
            method: 'get',
            tables: [
                { table: dataTable, access: DynamoDBAccess.read, indexes: ['', MttIndexes.license] },
                { table: primaryTable, access: DynamoDBAccess.read }
            ],
            appsync: [ {api: props.appsync, access: { queries: ['getAppsForLicense'] }}]
        });
    
        api.addLambdaHandler({
            id: 'manageAppDeleteV2',
            codePath: 'src/v2/manage/app/delete.ts',
            handler: 'handleEvent',
            path: '/api/v2/manage/app',
            method: 'delete',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ],
            ssm: [{ param: appDetailsKey, access: MttParameterAccess.read }],
            appsync: [ 
                { 
                    api: props.appsync, 
                    access: { 
                        queries: ['getAppsForDevice'], 
                        mutations: ['updateApp'] 
                    }
                }
            ]
        });
    
        api.addLambdaHandler({
            id: 'manageAppPutV2',
            codePath: 'src/v2/manage/app/put.ts',
            handler: 'handleEvent',
            path: '/api/v2/manage/app',
            method: 'put',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite, indexes: ['', MttIndexes.device] },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ],
            appsync: [ 
                { 
                    api: props.appsync, 
                    access: { 
                        queries: ['getAppsForDevice'], 
                        mutations: ['updateApp'] 
                    }
                }
            ]
        });
    
        api.addLambdaHandler({
            id: 'manageReportEfficacyPost',
            codePath: 'src/v2/manage/reports/efficacyPost.ts',
            handler: 'handleEvent',
            path: '/api/v2/manage/efficacy',
            method: 'post',
            tables: [
                { table: dataTable, access: DynamoDBAccess.read },
                { table: primaryTable, access: DynamoDBAccess.read }
            ],
            timestream: [{ table: timestream, access: MttTimestreamAccess.read }]
        });
    
        api.addLambdaHandler({
            id: 'manageReportTrackingOverTimeV2',
            codePath: 'src/v2/manage/reports/trackingOverTime.ts',
            handler: 'handleEvent',
            path: '/api/v2/manage/report/time',
            method: 'post',
            tables: [
                { table: dataTable, access: DynamoDBAccess.read },
                { table: primaryTable, access: DynamoDBAccess.read }
            ],
            timestream: [{ table: timestream, access: MttTimestreamAccess.read }]
        });
    
        api.addLambdaHandler({
            id: 'manageStudentsGetV2',
            codePath: 'src/v2/manage/license/studentsGet.ts',
            handler: 'handleEvent',
            path: '/api/v2/manage/students',
            method: 'get',
            tables: [
                { table: dataTable, access: DynamoDBAccess.read, indexes: ['', MttIndexes.license ] },
                { table: primaryTable, access: DynamoDBAccess.read, indexes: ['', MttIndexes.license ] }
            ]
        });
    
        api.addLambdaHandler({
            id: 'manageStudentsPutV2',
            codePath: 'src/v2/manage/license/studentsBulkPut.ts',
            handler: 'handleEvent',
            path: '/api/v2/manage/students',
            method: 'put',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite, indexes: ['', MttIndexes.license, MttIndexes.student ] },
                { table: primaryTable, access: DynamoDBAccess.readWrite, indexes: ['', MttIndexes.license ] }
            ],
            cognito: [{ pool: cognito, access: CognitoAccess.listUsers }]
        });
    
        api.addLambdaHandler({
            id: 'manageTemplatePut',
            codePath: 'src/v2/manage/templates/put.ts',
            handler: 'handleEvent',
            path: '/api/v2/manage/template',
            method: 'put',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite, indexes: ['', MttIndexes.license ] },
                { table: primaryTable, access: DynamoDBAccess.readWrite, indexes: ['', MttIndexes.license ] }
            ]
        });
    
        api.addLambdaHandler({
            id: 'manageTemplateDeleteV2',
            codePath: 'src/v2/manage/templates/delete.ts',
            handler: 'handleEvent',
            path: '/api/v2/manage/template',
            method: 'delete',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
    
        api.addLambdaHandler({
            id: 'manageTemplatesGet',
            codePath: 'src/v2/manage/templates/get.ts',
            handler: 'handleEvent',
            path: '/api/v2/manage/templates',
            method: 'get',
            tables: [
                { table: dataTable, access: DynamoDBAccess.read },
                { table: primaryTable, access: DynamoDBAccess.read }
            ]
        });
    }
}