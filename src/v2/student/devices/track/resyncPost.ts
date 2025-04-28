import { v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    schema: typesV2.DeviceResyncPostRequestSchema
});

export async function handler (request: typesV2.DeviceResyncPostRequest, userDetails: WebUserDetails) {
    console.log('Getting user');
    const user = await v2.UserDal.getUserConfig(userDetails.userId);
    if(!user.license) {
        throw new WebError('Access Denied');
    }

    console.log('Getting device config');
    const device = await v2.DeviceDal.get(request.dsn, request.studentId);
    WebUtils.logObjectDetails(device);
    if(device.license != user.license) {
        throw new WebError('Access Denied');
    }

    await v2.DeviceDal.putIdentity({
        dsn: request.dsn,
        identity: null as any
    });
}
