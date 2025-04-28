import { v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(handler, { 
    schema: typesV2.LicenseStudentTemplatePutSchema
});

export async function handler (request: typesV2.LicenseStudentTemplatePut, userDetails: WebUserDetails) {
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
    let existing = license.studentTemplates.find(x => x.name === (request.originalName ?? request.name));
    if(existing) {
        existing.appTemplates = request.appTemplates;
        existing.name = request.name;
        existing.desc = request.desc;
        existing.tags = request.tags;
        existing.behaviors = request.behaviors;
        existing.responses = request.responses;
    } else {
        existing = {
            name: request.name,
            desc: request.desc,
            behaviors: request.behaviors,
            responses: request.responses,
            tags: request.tags,
            appTemplates: request.appTemplates
        };
        license.studentTemplates.push(existing);
    }
    
    await v2.LicenseDal.save(license);

    const students = await v2.StudentDal.getStudentsByLicense(license.license!);
    for(const student of students) {
        await v2.processStudentTemplates(student, license.license!, {
            student: license.studentTemplates
        });
    }
}
