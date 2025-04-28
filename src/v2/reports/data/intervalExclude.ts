import { v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    schema: typesV2.StudentExcludeIntervalPutRequestSchema
});

export async function handler(request: typesV2.StudentExcludeIntervalPutRequest, userDetails: WebUserDetails) {
    console.log('Checking access');
    const user = await v2.TeamDal.getTeamMember(userDetails.userId, request.studentId);
    if(user.restrictions.data != typesV2.AccessLevel.admin) {
        throw new WebError('Access Denied');
    }

    const student = await v2.StudentDal.getStudentConfig(request.studentId);

    await v2.DataDal.excludeInterval(request.studentId, student.license, request.date, request.include);

    return { success: true };
}
