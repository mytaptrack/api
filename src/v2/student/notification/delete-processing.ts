import { v2, WebUserDetails, WebUtils} from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';
import { SQSEvent } from 'aws-lambda';

export const handleEvent = WebUtils.lambdaWrapper(handler);

export async function handler(event: SQSEvent) {
    await Promise.all(event.Records.map(async record => {
        const request = JSON.parse(record.body) as { message: typesV2.Notification<typesV2.NotificationDetailsBehavior>, userDetails: WebUserDetails };
        await processRecord(request.message, request.userDetails);
    }));
}

export async function processRecord(request: typesV2.Notification<typesV2.NotificationDetailsBehavior>, userDetails: WebUserDetails) {
    console.log('Evaluating event type', request.details.type);
    
    switch(request.details.type) {
        case 'behavior':
            console.log('Handling behavior event');
            await v2.UserDal.deleteStudentBehaviorNotification(userDetails.userId, request.details.studentId, request);
            break;
        case 'all':
            console.log('Removing all notifications');
            const notifications = await v2.UserDal.getStudentBehaviorNotifications(userDetails.userId, request.details.studentId);
            for(const n of notifications) {
                console.log('Deleting notification', n.date);
                await v2.UserDal.deleteStudentBehaviorNotification(userDetails.userId, request.details.studentId, n);
            }
            const stats = await v2.UserDal.getUserStudentStats(userDetails.userId);
            const statIndex = stats.findIndex(x => x.studentId == request.details.studentId);
            if(statIndex >= 0) {
                const stat = stats[statIndex];
                stat.count = 0;
                await v2.UserDal.updateUserEvent(userDetails.userId, stat, statIndex);
            }
            break;
        case 'pending':
            console.log('Removing pending notifications');
            await v2.UserDal.setStudentActiveNoResponse(userDetails.userId, request.details.studentId, false);
            break;
    }
};
