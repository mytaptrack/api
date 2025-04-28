import { UserSummaryRestrictions, QLSnapshotReport, QLSnapshotReports, QLSnapshotReportsKey } from '@mytaptrack/types';
import { MttAppSyncContext } from '@mytaptrack/cdk';
import { Moment, WebUtils, moment } from '@mytaptrack/lib';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSnapshot, getSnapshotKey } from './list';

const s3Client = new S3Client({});

interface Params {
    studentId: string;
    date: string;
    reportType: string;
    timezone: string;
}

export const handler = WebUtils.graphQLWrapper(handleEvent);

async function handleEvent(context: MttAppSyncContext<Params, never, never, {}>): Promise<QLSnapshotReport> {
    if(context.arguments.reportType != 'Weekly' && context.arguments.reportType != 'Range') {
        throw new Error('Invalid report type');
    }

    return await getSnapshot(context.arguments.studentId, moment(context.arguments.date), context.arguments.timezone, context.arguments.reportType as any, context.stash.permissions.student);
}
