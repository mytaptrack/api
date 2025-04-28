import { LambdaAppsyncQueryClient, WebUtils, generateDataKey, moment } from '@mytaptrack/lib';
import {
    QLReportData, QLReportService
} from '@mytaptrack/types';
import { Dal, DalKey } from '@mytaptrack/lib/dist/v2/dals/dal';
import { EventBridgeEvent, SQSEvent } from 'aws-lambda';
import { SQS } from '@aws-sdk/client-sqs';
import { uuid } from 'short-uuid';
import { S3 } from '@aws-sdk/client-s3';

interface AppSyncParams {
    studentId: string;
    data: QLReportData | QLReportService;
}

const dataDal = new Dal('data');
const sqs = new SQS({});
const s3 = new S3({});

const appsync = new LambdaAppsyncQueryClient(process.env.appsyncUrl);

export const handler = WebUtils.lambdaWrapper(handleEvent);

export async function handleEvent(event: { key: string }) {
    console.log('Handling event', event);
    const s3Result = await s3.getObject({
        Bucket: process.env.dataBucket,
        Key: `reprocess/${event.key}`
    });

    const data = await s3Result.Body.transformToString();
    console.debug('data', data);
    const input: {event: string}[] = JSON.parse(data);
    
    const recordStrings = input.map(x => x.event
        .replace(/\"/g, '\\"')
        .replace(/(?<=\W)\w+(?=(:\W))/g, '"$&"')
        .replace(/\'/g, '"')
        .replace(/\[Object\]/g, '[]'))
    console.info('Converted to serialized data objects');
    
    // const events = recordStrings.map(x => {
    //     console.debug(x);
    //     const endIndex = x.indexOf(', "Operation"');
    //     return {
    //         query: x.slice(0, endIndex).replace(/\"/g, '').replace(/\\n/g, '\n'),
    //         variables:  JSON.parse(x.slice(x.indexOf('"Variables": ') + 13).replace(/\\"/g, '"'))
    //     }
    // });
    
    // console.log('Clear impacted report data');
    // console.debug('records', events.map(x => x.query));

    // for(let i = 0; i < events.length; i++) {
    //     await appsync.query<QLReportData>(events[i].query, events[i].variables, '');
    // }
    const records = recordStrings.map(x => JSON.parse(x
        .replace(/\\n/g, '\n')
        .replace(/\'/g, '"')
        .replace(/\w+\:\W/g, '"$&": ')));
    console.debug('Parsed records', records);
    
    const studentReports: { [key: string]: { [key: number]: boolean }} = {};
    for(let i = 0; i < records.length; i++) {
        const data = records[i];

        if(!studentReports[data.studentId]) {
            studentReports[data.studentId] = {};
        }
        const startOfWeek = moment(data.dateEpoc).startOf('week').toDate().getTime();
        if(!studentReports[data.studentId][startOfWeek]) {
            await dataDal.update({
                key: generateDataKey(data.studentId, startOfWeek),
                updateExpression: 'SET #data = :data',
                attributeNames: {
                    '#data': 'data'
                },
                attributeValues: {
                    ':data': []
                }
            });
            studentReports[data.studentId][startOfWeek] = true;
        }

        if(!data.studentId) {
            console.debug('Processing message', data);
            await sqs.sendMessage({
                QueueUrl: process.env.DATA_QUEUE_URL,
                MessageBody: JSON.stringify(data.detail),
                MessageGroupId: data.detail.studentId
            });
        }
    }
    
    console.log('Send message complete');
}
