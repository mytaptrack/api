import { v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    schema: typesV2.StudentSubscriptionsSchema
});

function dedupeArray(val: string[]) {
    let indexes: {[key: string]: number} = {};
    for(let i = val.length - 1; i >= 0; i--) {
        const value = val[i];
        if(indexes[value] == undefined) {
            indexes[value] = i;
        } else {
            val.splice(i, 1);
        }
    }
}

export async function handler (request: typesV2.StudentSubscriptions, userDetails: WebUserDetails) {
    const team = await v2.TeamDal.getTeamMember(userDetails.userId, request.studentId);
    if(!team || team.restrictions.notifications != typesV2.AccessLevel.admin) {
        throw new WebError('Access Denied');
    }

    const student = await v2.StudentDal.getStudentConfig(request.studentId);
    request.license = student.license;

    request.notifications.forEach(sub => {
        dedupeArray(sub.behaviorIds);
        dedupeArray(sub.responseIds);
        dedupeArray(sub.userIds);
        dedupeArray(sub.deviceIds);
        dedupeArray(sub.emails);
        dedupeArray(sub.mobiles);
    });
    await v2.NotificationDal.put(request);
}
