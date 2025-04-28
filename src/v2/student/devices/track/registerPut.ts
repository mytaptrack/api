import { v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';
import shortUUID = require('short-uuid');

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    schema: typesV2.DeviceRegisterPutRequestSchema
});

export async function handler (request: typesV2.DeviceRegisterPutRequest, userDetails: WebUserDetails) {
    console.log('Getting student id');
    const studentId = request.studentId;
    if(!request.dsn) {
        request.dsn = shortUUID().new().toString();
    }

    console.log('Checking user access to license');
    if(!userDetails.licenses) {
        throw new WebError('Access Denied');
    }
    console.log('Checking licenses match');
    if(!request.license) {
        request.license = userDetails.licenses[0];
    }
    if(!userDetails.licenses.find(x => x == request.license)) {
        console.log('License does not match', request.license, userDetails.licenses);
        throw new WebError('Access Denied');
    }
    const device = await v2.DeviceDal.get(request.dsn);
    WebUtils.logObjectDetails(device);
    if(!device || !device.license) {
        console.log('Registering device');
        await v2.DeviceDal.register(request.dsn, request.license);
    } else {
        device.studentId = studentId;
        await v2.DeviceDal.setCurrentStudent(device.dsn, request.studentId);
    }
}