'use strict';
import { v2, WebUtils, WebError, WebUserDetails, moment } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';
import { PutObjectCommand, S3 } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { generate as uuidGenerate } from 'short-uuid';

const s3 = new S3();

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    schema: typesV2.PutDocumentRequestSchema
});

export async function handler(request: typesV2.PutDocumentRequest, webUser: WebUserDetails) {
    const teamMember = await v2.TeamDal.getTeamMember(webUser.userId, request.studentId);
    if(teamMember.restrictions.documents !== typesV2.AccessLevel.admin) {
        throw new WebError('You do not have permission to edit this student\'s documents');
    }

    if(!request.complete) {
        const result = await getSignedUrl(s3, new PutObjectCommand({
            Bucket: process.env.dataBucket,
            Key: `student/${request.studentId}/documents/${request.name}/${request.timerange.start}/${request.name}`,
            ServerSideEncryption: 'AES256',
            ContentType: 'application/octet-stream',
            ACL: 'bucket-owner-full-control',
            
        }), { expiresIn: 60 * 60 });
        return result;
    } else {
        const student = await v2.StudentDal.getStudentConfig(request.studentId);
        if(!student.documents) {
            student.documents = [];
        }
        const startTime = moment(request.timerange.start).toDate().getTime();
        let existing = student.documents.find(x => x.name == request.name && x.timerange.start == startTime);
        if(!existing) {
            existing = {
                id: uuidGenerate(),
                name: request.name,
                timerange: {
                    start: startTime
                },
                size: request.size,
                uploadDate: moment().toDate().getTime(),
                complete: true
            };
            student.documents.push(existing);
        } else {
            existing.complete = true;
            existing.uploadDate = moment().toDate().getTime();
            existing.size = request.size;
        }
        await v2.StudentDal.saveDocuments(request.studentId, student.documents);
        return existing;
    }
};
