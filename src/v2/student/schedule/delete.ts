import { v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { AccessLevel, typesV2 } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    schema: typesV2.ScheduleDeleteRequestSchema
});

export async function handler (request: typesV2.ScheduleDeleteRequest, userDetails: WebUserDetails) {
    console.log('Getting student id');
    const studentId = request.studentId;
    
    console.log('Checking if user is on students team');
    const team = await v2.TeamDal.getTeamMember(userDetails.userId, request.studentId, false);
    if(team.restrictions.devices !== AccessLevel.admin) {
        throw new WebError('Access Denied');
    }

    await v2.ScheduleDal.deleteSchedule(request.studentId, request.category, request.date);
}
