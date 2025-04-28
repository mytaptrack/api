import { v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { AccessLevel, typesV2 } from '@mytaptrack/types';
import shortUUID = require('short-uuid');

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    schema: typesV2.DevicePutRequestSchema
});

export async function handler (request: typesV2.DevicePutRequest, userDetails: WebUserDetails) {
    console.log('Getting student id');
    const studentId = request.studentId;
    if(!request.dsn) {
        request.dsn = shortUUID().new().toString();
    }

    console.log('Checking if user is on students team');
    const student = await v2.StudentDal.getStudent(studentId, userDetails.userId);
    if(student.restrictions.devices !== AccessLevel.admin) {
        throw new WebError('Access Denied');
    }

    console.log('Getting previous config');
    const device = await v2.DeviceDal.get(request.dsn);

    if(student.license != device.license) {
        throw new WebError('License mismatch');
    }
    
    console.log('Saving data');
    await v2.DeviceDal.update({
        deviceName: request.deviceName,
        dsn: request.dsn,
        license: device.license,
        timezone: request.timezone,
        isApp: false,
        multiStudent: true,
        studentId: request.studentId,
        commands: [],
        events: request.events,
        termSetup: false
    });

    device.deviceName = request.deviceName;
    device.events = request.events;
    return device;
}