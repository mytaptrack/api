import { DeviceDal, TeamDal, v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { AccessLevel, typesV2 } from '@mytaptrack/types';
import shortUUID = require('short-uuid');
import { v4 as uuid } from 'uuid';

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    schema: typesV2.StudentAbcDeleteSchema
});

export async function handler (request: typesV2.StudentAbcDelete, userDetails: WebUserDetails) {
    console.log('Getting student id');
    const studentId = request.studentId;

    console.log('Checking if user is on students team');
    const team = await v2.TeamDal.getTeamMember(userDetails.userId, studentId, false);
    if(team.restrictions.devices !== AccessLevel.admin) {
        throw new WebError('Access Denied');
    }
    const student = await v2.StudentDal.getStudent(request.studentId, userDetails.userId);
    
    const license = await v2.LicenseDal.get(student.license!);
    delete student.abc;

    console.log('Evaluating abc');
    v2.StudentDal.evaluateAbcCollections(student, license);

    console.log('Updating abc');
    WebUtils.logObjectDetails(student.abc);
    await v2.StudentDal.setStudentAbc(request.studentId, license.license!, student.abc);

    console.log('Returning result');
    return { abc: student.abc };
}