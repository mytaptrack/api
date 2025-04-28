import { NestedStack, NestedStackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { 
    CognitoAccess, DynamoDBAccess, MttCognito, MttContext, MttDynamoDB, MttRestApi
} from "@mytaptrack/cdk";

export interface AppUserApiStackProps extends NestedStackProps {
    apiSource: MttRestApi,
    dataTable: MttDynamoDB,
    primaryTable: MttDynamoDB,
    cognito: MttCognito,
    applicationName: string;
    parentStackName: string;
    coreStack: string;
}

export class ApiV2UserApi extends NestedStack {
    constructor(scope: Construct, id: string, props: AppUserApiStackProps) {
        super(scope, id, props);
        const { apiSource, dataTable, primaryTable, cognito } = props;
        const context = new MttContext(this, `${props.parentStackName}-user`, props.applicationName, undefined, props.coreStack)
        const api = new MttRestApi(context, apiSource);
        api.addLambdaHandler({
            id: 'userGetV2',
            codePath: 'src/v2/user/userGet.ts',
            handler: 'get',
            path: '/api/v2/user',
            method: 'get',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ],
            cognito: [{ pool: cognito, access: CognitoAccess.administrateGroups }]
        });
    
        api.addLambdaHandler({
            id: 'userPutV2',
            codePath: 'src/v2/user/userPut.ts',
            handler: 'put',
            path: '/api/v2/user',
            method: 'put',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
        
        api.addLambdaHandler({
            id: 'userAlertStatsGetV2',
            codePath: 'src/v2/user/alertStatsGet.ts',
            handler: 'get',
            path: '/api/v2/user/alerts',
            method: 'get',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
    }
}