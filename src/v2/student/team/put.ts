import { MailClient, v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { AccessLevel, TeamPutRequest, TeamPutRequestSchema, UserSummary, UserSummaryStatus } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    schema: TeamPutRequestSchema
});

export async function handler (request: TeamPutRequest, userDetails: WebUserDetails) {
    console.log('Getting student id');
    const studentId = request.studentId;

    console.log('Checking if user is on students team');
    const student = await v2.StudentDal.getStudent(studentId, userDetails.userId);
    const isLicenseAdmin = student.license && userDetails.licenses?.includes(student.license);
    if(!isLicenseAdmin && student.restrictions.team !== AccessLevel.admin) {
        throw new WebError('Access Denied');
    }

    if(!isLicenseAdmin && (request.restrictions.behaviors && request.restrictions.behaviors.length == 0)) {
        delete request.restrictions.behaviors;
    }

    let teamMember: UserSummary | undefined;
    if(request.userId) {
        try {
            console.log('Getting user', request.userId);
            teamMember = await v2.TeamDal.getTeamMember(request.userId, studentId, false);
            request.status = teamMember.status;
        } catch (err) {
            console.log('Error getting team member', err);
        }
    }

    if(request.details?.email) {
        request.details.email = request.details.email.replace(/\"/g, "").toLowerCase().trim();
    }

    let retval: UserSummary | undefined;
    if(!teamMember) {
        console.log('Getting user by email');
        request.details.email = request.details.email;
        
        if(!request.userId) {
            const userIds = await v2.UserDal.getUserIdsByEmail(request.details.email);
            if(userIds && userIds.length > 1) {
                await Promise.all(userIds.map(async userId => {
                    if(userId.startsWith('accounts.google.com_')) {
                        return;
                    }
                    await handler({
                        ...JSON.parse(JSON.stringify(request)),
                        userId
                    }, userDetails)
                }));
                return;
            }
            request.userId = userIds? userIds[0] : '';
        }
        if(!request.userId) {
            console.log('User does not exist, creating email notification');
            await v2.UserDal.saveUserInvite(request.details.email, studentId, {
                date: new Date().getTime(),
                restrictions: request.restrictions,
                status: request.status,
                requester: userDetails.userId
            });
            request.userId = request.details.email;
            retval = {
                userId: request.details.email,
                studentId,
                status: UserSummaryStatus.PendingVerification,
                details: {
                    email: request.details.email,
                    name: request.details.email,
                },
                restrictions: request.restrictions,
                version: 1
            };
        } else {
            try {
                console.log('Getting user attempt 2', request.userId);
                teamMember = await v2.TeamDal.getTeamMember(request.userId, studentId, false);
                request.status = teamMember.status;
            } catch (err) {
                console.log('Error getting team member', err);
            }

            if(!teamMember) {
                console.log('Adding team member');
                WebUtils.logObjectDetails(request);
                const userPii = await v2.UserDal.getUserPii(request.userId);
                retval = {
                    userId: request.userId,
                    studentId: request.studentId,
                    restrictions: request.restrictions,
                    license: student.license,
                    status: UserSummaryStatus.PendingApproval,
                    details: {
                        name: userPii?.details.name ?? request.details.email,
                        email: userPii?.details.email ?? request.details.email
                    },
                    version: 1
                } as UserSummary;
                await v2.TeamDal.putTeamMember(retval);
            }
        }
    }
    if(teamMember) {
        try {
            request.status = teamMember.status;

            console.log('Updating team member');
            WebUtils.logObjectDetails(request);
            retval = await v2.TeamDal.putTeamMember({
                ...request,
                license: student.license
            });
        } catch (err) {
            
        }
    }

    console.log('Sending email to invitee');
    if(request.sendEmail) {
        await MailClient.sendTemplateEmail(
            '/invite-team-member.html',
            `You've been invited to join ${student.details.firstName}'s team`,
            student,
            userDetails.name,
            {
                name: request.details.email,
                email: request.details.email,
                role: 'team member'
            }, [request.details.email]);
    }

    return retval;
}
