import { v2, WebUserDetails, WebError, WebUtils } from '@mytaptrack/lib';
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
    processBody: 'None',
    schema: QueryParamsSchema
});

export async function handler (request: QueryParams, userDetails: WebUserDetails) {
    if(!userDetails.licenses || !userDetails.licenses.find(x => x === request.license)) {
        throw new WebError('License not found');
    }
    console.log('Getting students');
    
    const [results, admins] = await Promise.all([
        v2.UserDal.getUsersForLicense(request.license),
        v2.UserDal.getAdminsForLicense(request.license)
    ]);
    
    const retval = {
        users: [
            ...results,
            ...admins
        ]
    };

    console.log('Returning results');
    return retval;
}
