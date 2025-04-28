import { NestedStack, NestedStackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { AppApiStackProps } from "../params";
import { CognitoAccess, DynamoDBAccess, MttCognito, MttContext, MttDynamoDB, MttParameter, MttParameterAccess, MttRestApi, MttS3, MttTimestream, MttTimestreamAccess } from "@mytaptrack/cdk";

export interface AppLicenseApiStackProps extends NestedStackProps {
    apiSource: MttRestApi,
    dataTable: MttDynamoDB,
    primaryTable: MttDynamoDB,
    cognito: MttCognito,
    applicationName: string;
    timestream: MttTimestream;
    parentStackName: string;
    coreStack: string;
}

export class ApiV2LicenseApi extends NestedStack {
    constructor(scope: Construct, id: string, props: AppLicenseApiStackProps) {
        super(scope, id, props);
        const { apiSource, dataTable, primaryTable, cognito, timestream } = props;
        const context = new MttContext(this, `${props.parentStackName}-license`, props.applicationName, undefined, props.coreStack)
        const api = new MttRestApi(context, apiSource);
        
        api.addLambdaHandler({
            id: 'licenseCreate',
            codePath: 'src/v2/licenses/put.ts',
            handler: 'handleEvent',
            path: '/api/v2/license',
            method: 'put',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
    
        api.addLambdaHandler({
            id: 'licenseDelete',
            codePath: 'src/v2/licenses/delete.ts',
            handler: 'handleEvent',
            path: '/api/license',
            method: 'delete',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
    
        api.addLambdaHandler({
            id: 'licensesGet',
            codePath: 'src/v2/licenses/getLicenses.ts',
            handler: 'handleEvent',
            path: '/api/v2/licenses',
            method: 'get',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite, indexes: ['', 'License'] },
                { table: primaryTable, access: DynamoDBAccess.readWrite, indexes: ['', 'License'] }
            ],
            timestream: [
                { table: timestream, access: MttTimestreamAccess.read }
            ],
            cognito: [
                { pool: cognito, access: CognitoAccess.listUsers }
            ]
        });
    
        api.addLambdaHandler({
            id: 'licenseDisplayTagsPut',
            codePath: 'src/v2/manage/license/displayTagsPut.ts',
            handler: 'handleEvent',
            path: '/api/v2/license/displaytags',
            method: 'put',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
    
        api.addLambdaHandler({
            id: 'licenseStudentDelete',
            codePath: 'src/v2/manage/license/studentDelete.ts',
            handler: 'handleEvent',
            path: '/api/v2/license/student',
            method: 'delete',
            tables: [
                { table: dataTable, access: DynamoDBAccess.readWrite, indexes: ['', 'Student'] },
                { table: primaryTable, access: DynamoDBAccess.readWrite }
            ]
        });
    }
}