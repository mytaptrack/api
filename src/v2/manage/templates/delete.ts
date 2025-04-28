import { v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(handler, { 
    schema: typesV2.LicenseStudentTemplateDeleteSchema
});

export async function handler (request: typesV2.LicenseStudentTemplateDelete, userDetails: WebUserDetails) {
    if(!userDetails.licenses || !userDetails.licenses.includes(request.license)) {
        throw new WebError('Access Denied');
    }
    
    const license = await v2.LicenseDal.get(request.license);
    if(!license) {
        throw new WebError('License Not Found');
    }

    if(!license.studentTemplates) {
        license.studentTemplates = [];
    }
    const existing = license.studentTemplates.findIndex(x => x.name === request.name);
    if(existing >= 0) {
        license.studentTemplates.splice(existing, 1);
    }
    
    await v2.LicenseDal.save(license);
}
