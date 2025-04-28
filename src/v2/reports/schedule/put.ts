import { LambdaAppsyncQueryClient, v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { QLReportDetailsSchedule, typesV2 } from '@mytaptrack/types';

const appsync = new LambdaAppsyncQueryClient(process.env.appsyncUrl);

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    schema: typesV2.OverwriteSchedulePutRequestSchema
});

export async function handler(request: typesV2.OverwriteSchedulePutRequest, userDetails: WebUserDetails) {
    console.log('Checking access');
    const user = await v2.TeamDal.getTeamMember(userDetails.userId, request.studentId);
    if(user.restrictions.data !== typesV2.AccessLevel.admin ||
        user.restrictions.schedules === typesV2.AccessLevel.none) {
        throw new WebError('Access Denied');
    }

    await appsync.query<QLReportDetailsSchedule>(`
        mutation updateReportDaySchedule($data: ReportDetailsScheduleInput!, $studentId: String!) {
            updateReportDaySchedule(data: $data, studentId: $studentId) {
                date
                schedule
            }
        }`,
    {
        studentId: request.studentId,
        data: {
            date: request.date,
            schedule: request.scheduleName
        }
    }, 'updateReportDaySchedule');

    return { success: true };
}