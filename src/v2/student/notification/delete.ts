import { SQS } from '@aws-sdk/client-sqs';
import { WebUserDetails, WebUtils} from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';

const sqs = new SQS();

export const handleEvent = WebUtils.apiWrapperEx(handler, { 
    schema: typesV2.NotificationDetailsDeleteSchema
});

export async function handler (request: typesV2.Notification<typesV2.NotificationDetailsBehavior>, userDetails: WebUserDetails) {
    console.log('Evaluating event type', request.details.type);
    await sqs.sendMessage({
        QueueUrl: process.env['NOTIFICATION_DELETE_QUEUE']!,
        MessageGroupId: request.details.studentId,
        MessageDeduplicationId: request.details.studentId + new Date().getTime(),
        MessageBody: JSON.stringify({ messageGroup: request.details.studentId, message: request, userDetails })
    });
};
