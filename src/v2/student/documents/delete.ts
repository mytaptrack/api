'use strict';
import { v2, WebUtils, WebError, WebUserDetails } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';
import { S3 } from '@aws-sdk/client-s3';

const s3 = new S3();

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    schema: typesV2.DeleteDocumentRequestSchema
});

export async function handler(request: typesV2.DeleteDocumentRequest, webUser: WebUserDetails) {
    const teamMember = await v2.TeamDal.getTeamMember(webUser.userId, request.studentId);
    if(teamMember.restrictions.documents !== typesV2.AccessLevel.admin) {
        throw new WebError('You do not have permission to edit this student\'s documents');
    }

    const documents = (await v2.StudentDal.getDocuments(request.studentId)) ?? [];
    const document = documents.find(x => x.id == request.id);
    if(!document) {
        return;
    }
    console.log('Deleting S3 object');
    await s3.deleteObject({
        Bucket: process.env.dataBucket!,
        Key: `student/${request.studentId}/documents/${document.name}/${document.timerange.start}`
    });

    console.log('Deleting document');
    await v2.StudentDal.saveDocuments(request.studentId, documents.filter(x => x.id != request.id));
    console.log('Document deleted');
};
