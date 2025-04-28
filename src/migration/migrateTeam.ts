import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { UserStudentTeam, WebUtils } from "@mytaptrack/lib";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const studentLicenseMap: {[key: string]: string } = {};

export const onCreate = WebUtils.lambdaWrapper(onCreateHandler);

export async function onCreateHandler(event) {
    console.log('Event: ', event);

    const promises: any[] = [];
    const tableName = process.env.DataTable;
    let token: any;
    do {
        const scanCommand = new ScanCommand({
            TableName: tableName,
            FilterExpression: 'begins_with(pk, :pkVal) AND begins_with(sk, :skVal)',
            ExpressionAttributeValues: {
                ':pkVal': 'U#',
                ':skVal': 'S#'
            },
            ExclusiveStartKey: token
        });

        const scanResults = await client.send(scanCommand);
        token = scanResults.LastEvaluatedKey;

        if (scanResults.Items && scanResults.Items.length > 0) {
            for (let item of scanResults.Items as UserStudentTeam[]) {
                if(!item.sk.endsWith('#S') && item.lpk) {
                    continue;
                }
                if(item.lpk && item.license && item.behaviorTracking != undefined) {
                    continue;
                }
                console.log('Processing item, pk:', item.pk, ', sk: ', item.sk);
                if(!studentLicenseMap[item.studentId]) {
                    const studentResult = await client.send(new GetCommand({
                        TableName: tableName,
                        Key: { pk: `S#${item.studentId}`, sk: 'P' },
                        ProjectionExpression: 'studentId,license'
                    }));
                    if(!studentResult?.Item || !studentResult.Item.license) {
                        continue;
                    }

                    studentLicenseMap[item.studentId] = studentResult.Item.license;
                }
                console.log('Updating', JSON.stringify(item));
                const updateCommand = new UpdateCommand({
                    TableName: tableName,
                    Key: {
                        pk: item.pk,
                        sk: item.sk,
                    },
                    UpdateExpression: 'SET #license = :newVal, behaviorTracking = :behaviorTracking, serviceTracking = :serviceTracking, lpk = :lpk, lsk = :lsk',
                    ExpressionAttributeNames: { '#license': 'license' },
                    ExpressionAttributeValues: { 
                        ':newVal': studentLicenseMap[item.studentId],
                        ':behaviorTracking': item.behaviorTracking != false || 
                            (item.behaviorTracking == false && item.serviceTracking == false)? true : false,
                        ':serviceTracking': item.serviceTracking ?? false,
                        ':lpk': `${studentLicenseMap[item.studentId]}#T`,
                        ':lsk': `U#${item.userId}#S#${item.studentId}`
                    },
                });

                const cmdPromise = client.send(updateCommand);
                promises.push(cmdPromise.then(() => { promises.splice(promises.findIndex(x => x == cmdPromise), 1)}));

                if(promises.length > 20) {
                    await Promise.all(promises);
                    promises.splice(0);
                }
            }
        }
    } while (token);

    return { physicalResourceId: 'migrate-team-data-complete' };
}
