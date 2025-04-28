import { WebUtils, WebUserDetails, v2 } from '@mytaptrack/lib';
import { install } from 'source-map-support';
install();

export const get = WebUtils.apiWrapperEx(userGet, { processBody: 'None' });

export async function userGet(request: string, userDetails: WebUserDetails) {
    console.log('Getting summary for user: ' + userDetails.userId);
    let [invites, stats] = await Promise.all([
        v2.UserDal.getUserTeamInvites(userDetails.userId, userDetails.email),
        v2.UserDal.getUserStudentStats(userDetails.userId)
    ]);
    console.log('user retrieved');

    return {
        invites,
        stats: stats?.map(s => ({
            studentId: s.studentId,
            alertCount: s.count,
            awaitingResponse: s.awaitingResponse
        })) ?? []
    };
}
