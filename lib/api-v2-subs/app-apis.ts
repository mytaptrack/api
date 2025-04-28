import { NestedStack, NestedStackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { AppApiStackProps } from "../params";
import { 
    AppSyncApi,
    DynamoDBAccess, MttCognito, MttContext, MttDynamoDB, MttParameter, MttParameterAccess, 
    MttRestApi
} from "@mytaptrack/cdk";

export interface AppV2AppApiStackProps extends NestedStackProps {
    apiSource: MttRestApi,
    dataTable: MttDynamoDB,
    primaryTable: MttDynamoDB,
    cognito: MttCognito,
    applicationName: string;
    AppTokenKey: MttParameter;
    AppDetailsKey: MttParameter;
    coreStack: string;
    parentStackName: string;
    appsync: AppSyncApi;
}

export class ApiV2AppApi extends NestedStack {
    constructor(scope: Construct, id: string, props: AppV2AppApiStackProps) {
        super(scope, id, props);
        const { apiSource, dataTable, primaryTable, cognito, AppTokenKey, AppDetailsKey } = props;
        const context = new MttContext(this, `${props.parentStackName}-app`, props.applicationName, undefined, props.coreStack)
        const api = new MttRestApi(context, apiSource);
        
        api.addLambdaHandler({
            id: 'devicesGetV2',
            codePath: 'src/v2/student/devices/general/get.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/devices',
            method: 'get',
            environmentVariables: {
                STRONGLY_CONSISTENT_READ: 'true'
            },
            tables: [
                { table: dataTable, access: DynamoDBAccess.read },
                { table: primaryTable, access: DynamoDBAccess.read }
            ],
            appsync: [
                { 
                    api: props.appsync, 
                    access: { queries: ['getAppsForDevice'] }
                }
            ]
        });
    
        api.addLambdaHandler({
            id: 'appPutV2',
            codePath: 'src/v2/student/devices/app/put.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/devices/app',
            method: 'put',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ],
            appsync: [
                { 
                    api: props.appsync, 
                    access: { queries: ['getAppsForDevice'], mutations: ['updateApp'] }
                }
            ]
        });
    
        api.addLambdaHandler({
            id: 'appDeleteV2',
            codePath: 'src/v2/student/devices/app/delete.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/devices/app',
            method: 'delete',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ],
            appsync: [
                { 
                    api: props.appsync, 
                    access: { queries: ['getAppsForDevice'], mutations: [ 'updateApp' ] }
                }
            ]
        });
    
        api.addLambdaHandler({
            id: 'appTokenGetV2',
            codePath: 'src/v2/student/devices/app/tokenGet.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/devices/app/token',
            method: 'get',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite }
            ],
            ssm: [
                { param: AppTokenKey, access: MttParameterAccess.read },
                { param: AppDetailsKey, access: MttParameterAccess.read }
            ],
            appsync: [
                { 
                    api: props.appsync, 
                    access: { queries: ['getAppsForDevice'] }
                }
            ]
        });

        api.addLambdaHandler({
            id: 'appQRCodeGetV2',
            codePath: 'src/v2/student/devices/app/qrCodeGet.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/devices/app/qrcode',
            method: 'get',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite }
            ],
            ssm: [
                { param: AppTokenKey, access: MttParameterAccess.read },
                { param: AppDetailsKey, access: MttParameterAccess.read }
            ],
            appsync: [
                { 
                    api: props.appsync, 
                    access: { queries: ['getAppsForDevice'] }
                }
            ]
        });
    
        api.addLambdaHandler({
            id: 'deviceTrackTermGetV2',
            codePath: 'src/v2/student/devices/track/termGet.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/devices/track/term',
            method: 'get',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ],
            ssm: [
                { param: AppTokenKey, access: MttParameterAccess.read },
                { param: AppDetailsKey, access: MttParameterAccess.read }
            ]
        });
    
        api.addLambdaHandler({
            id: 'deviceTrackTermPutV2',
            codePath: 'src/v2/student/devices/track/termPut.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/devices/track/term',
            method: 'put',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
    
        api.addLambdaHandler({
            id: 'deviceTrackRegisterPutV2',
            codePath: 'src/v2/student/devices/track/registerPut.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/devices/track/register',
            method: 'put',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
    
        api.addLambdaHandler({
            id: 'deviceTrackResyncPutV2',
            codePath: 'src/v2/student/devices/track/resyncPost.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/devices/track/resync',
            method: 'post',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
    
        api.addLambdaHandler({
            id: 'deviceTrackPutV2',
            codePath: 'src/v2/student/devices/track/put.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/devices/track',
            method: 'put',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
    
        api.addLambdaHandler({
            id: 'deviceTrackDeleteV2',
            codePath: 'src/v2/student/devices/track/delete.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/devices/track',
            method: 'delete',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
    
        api.addLambdaHandler({
            id: 'deviceTrackGetV2',
            codePath: 'src/v2/student/devices/track/get.ts',
            handler: 'handleEvent',
            path: '/api/v2/student/devices/track',
            method: 'get',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ],
            ssm: [
                { param: AppTokenKey, access: MttParameterAccess.read },
                { param: AppDetailsKey, access: MttParameterAccess.read }
            ]
        });
    }
}