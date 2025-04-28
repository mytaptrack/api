import { IoTClickType, LambdaAppsyncQueryClient, moment, v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { QLAppDeviceConfiguration, QLReportDataInput, typesV2 } from '@mytaptrack/types';

const appsync = new LambdaAppsyncQueryClient(process.env.appsyncUrl);

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    schema: typesV2.StudentTrackPutSchema
});

export async function handler(request: typesV2.StudentTrackPut, userDetails: WebUserDetails) {
    console.log('Checking access');
    const user = await v2.TeamDal.getTeamMember(userDetails.userId, request.studentId);
    if(user.restrictions.data != typesV2.AccessLevel.admin) {
        throw new WebError('Access Denied');
    }
    
    const retval = await v2.DataDal.getData(request.studentId, moment(request.date).startOf('day'), moment(request.date).add(1, 'day').startOf('day'));

    if(!retval) {
        return { sucess: true };
    }

    const dateEpoc = moment(request.date).toDate().getTime();

    const event = retval.data.find(x => x.dateEpoc == dateEpoc);

    if(!event) {
        return { success: true };
    }

    await appsync.query<QLAppDeviceConfiguration>(`
        mutation updateDataInReport($data: ReportDataInput!, $studentId: String!) {
            updateDataInReport(data: $data, studentId: $studentId) {
                dateEpoc
            }
        }`,
        {
            data: {
                ...event,
                redoDurations: true,
                deleted: {
                    date: moment().toISOString(),
                    by: userDetails.userId
                }
            } as QLReportDataInput,
            studentId: request.studentId
        }, 'updateDataInReport');

    return { success: true };
}