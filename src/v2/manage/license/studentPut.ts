import { v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(put, {
    schema: typesV2.ApplyLicenseRequestSchema
});

export async function put(request: typesV2.ApplyLicenseRequest, user: WebUserDetails) {
    console.log('Getting license');
    if(!user.licenses || !user.licenses.find(x => x === request.license)) {
        throw new WebError('License not found');
    }

    const license = await v2.LicenseDal.get(request.license);
    const summary: typesV2.LicenseSummary = {
        expiration: license.expiration,
        fullYear: request.licenseDetails.fullYear,
        flexible: request.licenseDetails.flexible,
        features: license.features!
    };
    
    console.log('Updating student');
    await v2.StudentDal.updateLicense(request.studentId, request.license, summary, request.archive, undefined as any)
    console.log('License applied');
    
    const apps = await v2.AppDal.getAppsForStudent(request.studentId);
    await Promise.all(apps.map(async app => {
        if(app.license != request.license) {
            console.log('Updating app', app.id);
            const global = await v2.AppDal.getGlobalConfig(app.license, app.deviceId!);
            if(global) {
                global.license = request.license;
                await Promise.all([
                    v2.AppDal.updateLicense(app.studentId, app.id, request.license),
                    v2.AppDal.updateAppGlobalPii(app.deviceId!, request.license, global.deviceName, [])
                ]);
            }
        }
    }));
    if(license.studentTemplates && license.studentTemplates.length > 0) {
        const student = await v2.StudentDal.getStudent(request.studentId);
        student.archived = request.archive;
        WebUtils.logObjectDetails(student);
        await v2.processStudentTemplates(student, request.license, { student: license.studentTemplates });
        return student;
    }

    return {
        license: request.license,
        licenseDetails: {
            fullYear: request.licenseDetails.fullYear,
            flexible: request.licenseDetails.flexible,
            expiration: license.expiration,
            features: license.features
        }
    } as typesV2.Student;
}
