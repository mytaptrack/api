import { 
    v2, WebError, WebUserDetails, WebUtils, moment, LambdaAppsyncQueryClient 
} from '@mytaptrack/lib';
import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';
import { QLReportData, QLReportDataInput, ReportData, typesV2 } from '@mytaptrack/types';
import { request } from '../../../graphql/resolver/mutations/student/service/update-definition/data';

const data = new Dal('data');

const appsync = new LambdaAppsyncQueryClient(process.env.appsyncUrl);

export const handleEvent = WebUtils.apiWrapperEx(trackPut, {
    schema: typesV2.StudentDataPutSchema
});

export async function trackPut(request: typesV2.StudentDataPut, userDetails: WebUserDetails): Promise<ReportData> {
    console.log('Recovery data:', request);
    console.log('Checking access');
    const user = await v2.TeamDal.getTeamMember(userDetails.userId, request.studentId);
    if(user.restrictions.data != typesV2.AccessLevel.admin) {
        throw new WebError('Access Denied');
    }

    let isManual = true;
    const now = moment();
    if(Math.abs(now.diff(moment(request.eventDate), 'minutes')) <= 5) {
        isManual = false;
    }

    const dateEpoc = moment(request.eventDate).toDate().getTime();

    const result = await appsync.query<QLReportData>(`
        mutation updateDataInReport($data: ReportDataInput!, $studentId: String!) {
            updateDataInReport(data: $data, studentId: $studentId) {
                dateEpoc
                behavior
                duration
                abc {
                    a
                    c
                }
            }
        }
        `,
        {
            data: {
                dateEpoc,
                behavior: request.behaviorId,
                isManual: isManual,
                abc: request.abc,
                intensity: request.intensity,
                source: {
                    device: 'website',
                    rater: userDetails.userId
                },
                redoDurations: true
            } as QLReportDataInput,
            studentId: request.studentId
        }, 'updateDataInReport');

    return {
        behavior: request.behaviorId,
        dateEpoc,
        abc: request.abc,
        intensity: request.intensity,
        isManual: result.isManual ?? false,
    };
}
