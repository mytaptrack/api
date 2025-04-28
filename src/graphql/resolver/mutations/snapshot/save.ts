import { QLSnapshotReport } from '@mytaptrack/types';
import { MttAppSyncContext } from '@mytaptrack/cdk';
import { WebUtils, moment } from '@mytaptrack/lib';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSnapshotKey, getSnapshotSavedKey } from '../../query/getSnapshot/list';

const s3Client = new S3Client({});

interface Params {
    studentId: string;
    date: string;
    reportType: string;
    snapshot: QLSnapshotReport;
}

export const handler = WebUtils.graphQLWrapper(handleEvent);

async function handleEvent(context: MttAppSyncContext<Params, never, never, {}>): Promise<QLSnapshotReport> {
    const snapshot = context.arguments.snapshot;

    const date = moment(context.arguments.date, 'yyyy-MM-DD').startOf('week');
    const saveKey = getSnapshotSavedKey(context.arguments.studentId, context.arguments.reportType, date);
    const publishedKey = getSnapshotKey(context.arguments.studentId, context.arguments.reportType, date)
    const key = snapshot.published != false? publishedKey : saveKey;

    console.info('Saving data to', key);
    await s3Client.send(new PutObjectCommand({
        Bucket: process.env.dataBucket,
        Key: key,
        Body: JSON.stringify(snapshot)
    }));

    if(snapshot.published) {
        try {
            console.log('Removing data from working file', saveKey);
            await s3Client.send(new DeleteObjectCommand({
                Bucket: process.env.dataBucket,
                Key: saveKey
            }));
        } catch (err) {
            console.warn('Error deleting working file', err);
        }
    }

    return snapshot;
}
