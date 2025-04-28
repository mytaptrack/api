import { v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(put, {
    schema: typesV2.LicenseDisplayTagsPutSchema
});

export async function put(request: typesV2.LicenseDisplayTagsPut, user: WebUserDetails) {
    console.log('Getting license');
    if(!user.licenses || !user.licenses.find(x => x === request.license)) {
        throw new WebError('License not found');
    }

    await v2.LicenseDal.putTags(request.license, request.displayTags);
}
