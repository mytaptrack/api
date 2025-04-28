import { S3 } from '@aws-sdk/client-s3';
import { v2, WebUtils, WebError, WebUserDetails } from '@mytaptrack/lib';
import { AccessLevel, StudentReportPostRequest, StudentSummaryReport } from '@mytaptrack/types';

const s3 = new S3();

export const handleEvent = WebUtils.apiWrapperEx(reportGet, { 
    processBody: 'Parameters',
    schema: {
        type: 'object',
        properties: {
            studentId: { type: 'string', required: true }
        }
    }
});

export async function reportGet (request: { studentId: string }, userDetails: WebUserDetails) {
    const team = await v2.TeamDal.getTeamMember(userDetails.userId, request.studentId);
    WebUtils.logObjectDetails(team);
    if(team.restrictions.reports == AccessLevel.none) {
        throw new WebError('Access Denied');
    }

    const Prefix = `student/${request.studentId}/reports/Weekly/`;
    const prefixLength = Prefix.length;
    console.log('Listing objects');
    const listResults = await s3.listObjects({
        Bucket: process.env.dataBucket!,
        Prefix
    });

    console.log('Sorting and mapping objects');
    const dates = listResults.Contents?.map(x => x.Key)
    .sort().reverse()
    .map(x => {
        const dotIndex = x!.indexOf('.');
        const [ year, monthDay ] = x!.slice(prefixLength, dotIndex).split('/');
        return monthDay.replace('-', '/') + '/' + year;
    }) ?? [];
    
    console.log('Returning dates');
    return dates;
}
