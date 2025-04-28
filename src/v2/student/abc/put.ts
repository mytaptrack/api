import { DeviceDal, TeamDal, v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { AccessLevel, typesV2 } from '@mytaptrack/types';
import shortUUID = require('short-uuid');
import { v4 as uuid } from 'uuid';

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    schema: typesV2.StudentAbcPutSchema
});

export async function handler (request: typesV2.StudentAbcPut, userDetails: WebUserDetails) {
    console.log('Getting student id');
    const studentId = request.studentId;

    console.log('Checking if user is on students team');
    const team = await v2.TeamDal.getTeamMember(userDetails.userId, studentId, false);
    if(team.restrictions.abc !== AccessLevel.admin) {
        throw new WebError('Access Denied');
    }
    delete (request as any).studentId;

    const conf = await v2.StudentDal.getStudentConfig(studentId);

    await v2.StudentDal.setStudentAbc(studentId, conf.license, request);

    return request;
}