import { MttAppSyncContext } from '@mytaptrack/cdk';
import { 
    AppPiiGlobal, WebUtils,
    NotificationDal, StudentDal, UserPrimaryStorage, getAppGlobalKey, getUserPrimaryKey
} from '@mytaptrack/lib';
import { Dal, DalKey, MttIndexes } from '@mytaptrack/lib/dist/v2/dals/dal';
import {
    QLSubscriptionStudentConfig, QLSubscriptionStudentConfigNameId
} from '@mytaptrack/types';

export const handler = WebUtils.graphQLWrapper(handleEvent);

const primary = new Dal('primary');

interface AppSyncParams {
    studentId: string;
}

export async function handleEvent(context: MttAppSyncContext<AppSyncParams, any, any, any>): Promise<QLSubscriptionStudentConfig[]> {
    const studentId = context.arguments.studentId;
    
    const [subscriptions, [studentPii]] = await Promise.all([
        NotificationDal.get(studentId),
        StudentDal.getStudentsPii([studentId])
    ]);

    const setUserDetails = context.info.selectionSetList.find(x => x == 'users');
    const setDevicesDetails = context.info.selectionSetList.find(x => x == 'devices');

    const retval = await Promise.all(subscriptions.notifications.map(
        async subscription => {
            const userKeys = !setUserDetails? [] : subscription.userIds.map(uid => getUserPrimaryKey(uid));
            const deviceKeys = !setDevicesDetails? [] : subscription.deviceIds.map(did => getAppGlobalKey(studentPii.license, did));
            const users = await primary.batchGet<UserPrimaryStorage>(userKeys, 'userId, details');
            const devices = await primary.batchGet<AppPiiGlobal>(deviceKeys, 'deviceId, deviceName');
            return {
                studentId: studentId,
                name: subscription.name,
                behaviors: subscription.behaviorIds.map(b => {
                    const bPii = studentPii.behaviorLookup.find(bl => bl.id == b);
                    if(!bPii) {
                        return;
                    }
                    return {
                        id: b,
                        name: bPii.name
                    }
                }).filter(x => x? true : false),
                responses: subscription.responseIds.map(b => {
                    const bPii = studentPii.responseLookup.find(bl => bl.id == b);
                    if(!bPii) {
                        return;
                    }
                    return {
                        id: b,
                        name: bPii.name
                    }
                }).filter(x => x? true : false),
                notifyUntilResponse: subscription.notifyUntilResponse,
                users: users.map(u => ({ id: u.userId, name: u.details.name })),
                emails: subscription.emails,
                mobiles: subscription.mobiles,
                devices: devices.map(d => ({ id: d.deviceId, name: d.deviceName })),
                messages: subscription.messages
            } as QLSubscriptionStudentConfig;
        })
    );

    return retval;
}