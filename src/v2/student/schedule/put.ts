import { v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { AccessLevel, typesV2 } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    schema: typesV2.SchedulePutRequestSchema
});

export async function handler (request: typesV2.SchedulePutRequest, userDetails: WebUserDetails) {
    console.log('Getting student id');
    const studentId = request.studentId;
    
    console.log('Checking if user is on students team');
    const team = await v2.TeamDal.getTeamMember(userDetails.userId, request.studentId, false);
    if(team.restrictions.devices !== AccessLevel.admin) {
        throw new WebError('Access Denied');
    }
    const student = await v2.StudentDal.getStudentConfig(request.studentId);

    await v2.ScheduleDal.saveSchedule(request.studentId, student.license, request.schedule);

    return request.schedule;
}