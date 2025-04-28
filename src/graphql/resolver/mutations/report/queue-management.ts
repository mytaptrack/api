import { WebUtils, MttEventType } from '@mytaptrack/lib';
import {
    QLReportData, QLReportService
} from '@mytaptrack/types';
import { Dal, DalKey } from '@mytaptrack/lib/dist/v2/dals/dal';
import { EventBridgeEvent, SQSEvent } from 'aws-lambda';
import { SQS } from '@aws-sdk/client-sqs';

interface AppSyncParams {
    studentId: string;
    data: QLReportData | QLReportService;
}

const dataDal = new Dal('data');
const sqs = new SQS({});

export const handler = WebUtils.lambdaWrapper(handleEvent);

export async function handleEvent(event: EventBridgeEvent<MttEventType.trackEvent | MttEventType.trackService, AppSyncParams>) {
    console.log('Handling event', event);
    const input = event.detail;
    await sqs.sendMessage({
        QueueUrl: process.env.DATA_QUEUE_URL,
        MessageBody: JSON.stringify(input),
        MessageGroupId: input.studentId
    });
    console.log('Send message complete');
}
