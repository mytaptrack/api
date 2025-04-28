import { v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';

export const handleEvent = WebUtils.apiWrapperEx(handler, { 
    processBody: 'Parameters',
    schema: {
        type: 'object',
        properties: {
            license: { type: 'string', required: true }
        }
    }
});

export async function handler (request: { license: string }, userDetails: WebUserDetails) {      
    if(!userDetails.licenses || 
        userDetails.licenses.length == 0 || 
        !userDetails.licenses.find(x => x == request.license)) {
        throw new WebError('Access Denied');
    }

    console.log('Getting license', request.license);
    const license = await v2.LicenseDal.get(request.license);
    if(!license.abcCollections) {
        license.abcCollections = [];
    }
    return license;
}
