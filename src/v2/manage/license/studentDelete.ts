import { v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(put, {
    schema: {
        type: 'object',
        properties: {
            studentId: { type: 'string', required: true }
        }
    }
});

export async function put(request: { studentId: string}, user: WebUserDetails) {
    const studentConfig = await v2.StudentDal.getStudentConfig(request.studentId);
    console.log('Getting license');
    if(!user.licenses || !user.licenses.find(x => x === studentConfig.license)) {
        throw new WebError('License not found');
    }

    const studentTeam = await v2.TeamDal.getTeam(request.studentId);
    await Promise.all(studentTeam.map(async team => {
        if(team.deleted) {
            return;
        }

        await v2.TeamDal.removeUserFromTeam(team.userId, request.studentId);
    }));
    await v2.StudentDal.updateLicense(request.studentId, null as any, null as any, true, undefined as any);
}
