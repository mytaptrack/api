import { v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { AccessLevel, typesV2 } from '@mytaptrack/types';
import shortUUID = require('short-uuid');

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    schema: typesV2.TrackDeviceActionRequestSchema
});

export async function handler (request: typesV2.TrackDeviceActionRequest, userDetails: WebUserDetails) {
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
    const device = await v2.DeviceDal.getConfig(studentId, request.dsn);
    if(!device) {
        throw new WebError('Access Denied');
    }

    console.log('Getting updated data');
    const retval = await v2.DeviceDal.setTermSetup(request.dsn, request.studentId);
    return retval;
}