import {
    AppSyncIdentityCognito
} from 'aws-lambda';

import {
    UserStudentTeam, StudentConfigStorage, ServiceStorage,
    StudentPiiStorage, TrackableItem, PiiTrackable, StudentDal,
    WebUtils, WebError, moment, Moment, TeamDal, getUserStudentSummaryKey, StudentPii, ScheduleDal, isEqual, getStudentPrimaryKey, getUserPrimaryKey, getStudentUserDashboardKey, UserDashboardStorage, UserStudentNotificationStorage
} from '@mytaptrack/lib';
import {
    MttAppSyncContext
} from '@mytaptrack/cdk';
import {
    AccessLevel, QLStudent, QLStudentUpdateInput, QLTrackable,
    UserSummaryRestrictions, Student, StudentBehavior, Milestone, QLNotificationDelete
} from '@mytaptrack/types';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { uuid } from 'short-uuid';
import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';

const primary = new Dal('primary');
const data = new Dal('data');

export const handler = WebUtils.graphQLWrapper(handleEvent);

export async function handleEvent(context: MttAppSyncContext<{ notifications: QLNotificationDelete}, never, never, {}>): Promise<any[]> {
    console.debug('Context', context);
    let args = context.arguments.notifications;
    let notifications = args.events;
    const studentId = args.studentId;
    const userId = context.identity.username;

    if(args.events.length == 0) {
        const results = await data.query<UserStudentNotificationStorage>({
            keyExpression: `pk = :pk and begins_with(sk, :sk)`,
            attributeValues: {
                ':pk': `USN#${userId}`,
                ':sk': `S#${studentId}#T#`
            },
            projectionExpression: 'event'
        });

        notifications = results.map(x => ({ behaviorId: '', epoch: x.event.date}))
    }

    await Promise.all(notifications.map(async event => {
        await data.delete({ pk: `USN#${userId}`, sk: `S#${studentId}#T#${event.epoch}#TP#behavior`});
    }));
    return [];
}
