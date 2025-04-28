import { LicenseDal, StudentDal, TeamDal, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { AccessLevel, ApplyLicenseRequest, LicenseDetails } from '@mytaptrack/types';
import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const dynamodb = DynamoDBDocumentClient.from(new DynamoDB({}));

export const handleEvent = WebUtils.apiWrapperEx(post, {});

export async function post(request: ApplyLicenseRequest, user: WebUserDetails) {
    if(!request.license || !request.studentId || request.licenseDetails === undefined) {
        throw new WebError('Arguments invalid');
    }

    console.log('Validating license access');
    if(!user.licenses?.find(x => x == request.license)) {
        throw new WebError('Access Denied');
    }

    const studentConfig = await StudentDal.getStudentConfig(request.studentId);
    studentConfig.licenseDetails.flexible = request.licenseDetails.flexible;
    studentConfig.licenseDetails.fullYear = request.licenseDetails.fullYear;
    console.log('Updating student');
    await dynamodb.send(new UpdateCommand({
        TableName: process.env.StudentTable as string,
        Key: { studentId: request.studentId },
        UpdateExpression: 'SET license = :license, licenseDetails = :licenseDetails REMOVE deletedLicense',
        ExpressionAttributeValues: studentConfig.licenseDetails
    }));
    console.log('License applied');
    
    return null;
}
