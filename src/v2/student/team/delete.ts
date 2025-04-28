import { v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { AccessLevel, typesV2 } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    schema: typesV2.TeamDeleteRequestSchema
});

export async function handler (request: typesV2.TeamDeleteRequest, userDetails: WebUserDetails) {
    console.log('Getting student id');
    const studentId = request.studentId;

    console.log('Checking if user is on students team');
    const student = await v2.TeamDal.getTeamMember(userDetails.userId, studentId, false);
    const isLicenseAdmin = student.license && userDetails.licenses?.includes(student.license);
    if(!isLicenseAdmin && student.restrictions.devices !== AccessLevel.admin) {
        throw new WebError('Access Denied');
    }

    await Promise.all([
        v2.TeamDal.removeUserFromTeam(request.userId, request.studentId),
        v2.UserDal.deleteUserTeamInvite(request.userId, request.studentId)
    ]);
}
