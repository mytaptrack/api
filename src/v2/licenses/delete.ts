import { WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const dynamodb = DynamoDBDocumentClient.from(new DynamoDB({}));

export const handleEvent = WebUtils.apiWrapperEx(deleteEvent, { processBody: 'None', role: 'admins' });

export async function deleteEvent(request: string, userDetails: WebUserDetails) {
    if(!request) {
        throw new WebError('Invalid input');
    }
    console.log('Deleting data');
    await dynamodb.send(new DeleteCommand({
        TableName: process.env.LicenseTable!,
        Key: { license: JSON.parse(request) }
    }));
    console.log('Data deleted');

    console.log('Returning success');
    return { success: true };
}