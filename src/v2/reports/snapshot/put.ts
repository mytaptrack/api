import { S3 } from '@aws-sdk/client-s3';
import { v2, WebUtils, WebError, WebUserDetails, moment } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';

const s3 = new S3();

export const handleEvent = WebUtils.apiWrapperEx(reportPut, {
    schema: typesV2.StudentSummaryReportSchema
});

export async function reportPut (request: typesV2.StudentSummaryReport, userDetails: WebUserDetails) {
    const team = await v2.TeamDal.getTeamMember(userDetails.userId, request.studentId);
    console.debug("Team Details", team);
    if(team.restrictions.reports != typesV2.AccessLevel.admin) {
        console.info("Team restrictions do not match requirements ", team.restrictions.reports);
        throw new WebError('Access Denied');
    }

    console.info("Constructing request");
    request.lastModified = {
        userId: userDetails.userId,
        date: moment().toISOString()
    };
    let requestDate = moment(request.date);
    requestDate = requestDate.add(requestDate.weekday() * -1, 'day');

    console.info("Sending data to S3")
    const key = `student/${request.studentId}/reports/${request.type}/${requestDate.format('yyyy/MM-DD')}.json`
    console.debug(key);
    await s3.putObject({
        Bucket: process.env.dataBucket!,
        Key: key,
        ServerSideEncryption: 'aws:kms',
        StorageClass: 'STANDARD_IA',
        Body: JSON.stringify(request)
    });

    return { success: true };
}
