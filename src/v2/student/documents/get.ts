import { v2, WebError, WebUserDetails, WebUtils, moment } from '@mytaptrack/lib';
import { StudentDocument, typesV2 } from '@mytaptrack/types';
import { GetObjectCommand, S3 } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Schema } from 'jsonschema';

const s3 = new S3({});

const ParameterSchema: Schema = {
    type: 'object',
    properties: {
        studentId: { type: 'string', required: true },
        documentId: { type: 'string' }
    }
};

export const handleEvent = WebUtils.apiWrapperEx(handler, { processBody: 'Parameters', schema: ParameterSchema });

export async function handler (request: { studentId: string, documentId: string }, userDetails: WebUserDetails): Promise<any> {
    console.log('Getting student id');
    const studentId = request.studentId;

    console.log('Checking if user is on students team');
    const teamMember = await v2.TeamDal.getTeamMember(userDetails.userId, studentId);
    if(teamMember.restrictions.devices == typesV2.AccessLevel.none) {
        throw new WebError('Access Denied');
    }

    if(!request.documentId) {
        const documents = await v2.StudentDal.getDocuments(studentId);

        if(!documents) {
            return [] as StudentDocument[];
        }

        return documents;    
    } else {
        const documents = await v2.StudentDal.getDocuments(studentId);
        const document = documents.find(x => x.id == request.documentId);
        if(!document) {
            return '';
        }
        const signedUrl = await getSignedUrl(s3, new GetObjectCommand({
            Bucket: process.env.dataBucket,
            Key: `student/${request.studentId}/documents/${document.name}/${moment(document.timerange.start).format('YYYY-MM-DD')}/${document.name}`,
        }));
        return signedUrl;
    }
}
