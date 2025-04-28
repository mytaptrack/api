import { v2, WebUserDetails, WebUtils, WebError } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';
import { Schema } from 'jsonschema';

interface QueryParams {
    license: string;
}
const QueryParamsSchema: Schema = {
    type: 'object',
    properties: {
        license: { type: 'string', required: true }
    }
}

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    processBody: 'Parameters',
    schema: QueryParamsSchema,
});

export async function handler (request: QueryParams, userDetails: WebUserDetails) {
    if(!userDetails.licenses || !userDetails.licenses.find(x => x === request.license)) {
        throw new WebError('License not found');
    }
    console.log('Getting students');
    console.debug('userDetails', userDetails);
    
    const results = await v2.StudentDal.getStudentsByLicense(userDetails.licenses[0]);
    
    const retval: typesV2.ManageStudentGetResponse = {
        students: []
    };
    if(results && results) {
        retval.students = results
            .filter(x => x && x.details);
    }

    console.log('Returning results');
    return retval;
}