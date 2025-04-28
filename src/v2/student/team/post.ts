import { v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { typesV2, UserSummary, UserSummaryStatus } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    schema: typesV2.TeamPostRequestSchema
});

export async function handler (request: typesV2.TeamPostRequest, userDetails: WebUserDetails) {
    console.log('Getting student id');
    const studentId = request.studentId;

    console.log('Check all flag');
    if(request.all) {
        const invites = await v2.UserDal.getUserTeamInvites(userDetails.userId, userDetails.email);

        await Promise.all(invites.map(async invite => {
            await handler({
                ...JSON.parse(JSON.stringify(request)),
                studentId: invite.details.studentId,
                all: false
            }, userDetails);
        }));
        return;
    }

    console.log('Checking if user is on students team');

    if(request.accepted) {
        if(!request.studentId) {
            throw new WebError('Student ID is required', 400);
        }
        const [userInvite, student] = await Promise.all([
            v2.UserDal.getUserTeamInvite(userDetails.email, studentId),
            v2.StudentDal.getStudentConfig(studentId)
        ]);
        if(userInvite) {
            console.log('Invite found');
            const team: UserSummary = {
                userId: userDetails.userId,
                studentId,
                status: typesV2.UserSummaryStatus.Verified,
                restrictions: userInvite.restrictions,
                license: student.license,
                details: {
                    email: userDetails.email,
                    name: userDetails.name
                },
                version: 1
            };

            await v2.TeamDal.putTeamMember(team);
            await v2.UserDal.deleteUserTeamInvite(userDetails.email, request.studentId);
        } else {
            console.log('Getting team configuration');
            const invite = await v2.TeamDal.getTeamMember(userDetails.userId, studentId, false);
            if(invite.status == UserSummaryStatus.PendingApproval) {

                if(request.accepted) {
                    invite.status = UserSummaryStatus.Verified;

                    console.log('Putting team update');
                    v2.TeamDal.putTeamMember({
                        ...invite,
                        license: student.license
                    });
                } else {
                    v2.TeamDal.removeUserFromTeam(userDetails.userId, studentId);
                }
            }
        }
    } else {
        console.log('Invitation not accepted');
        await Promise.all([
            v2.TeamDal.removeUserFromTeam(userDetails.userId, request.studentId),
            v2.UserDal.deleteUserTeamInvite(userDetails.email, request.studentId)
        ]);
    }
}
