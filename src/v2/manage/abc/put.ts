import { v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx<typesV2.AbcCollection[]>(handler, { });

export async function handler (request: typesV2.AbcCollection[], userDetails: WebUserDetails) {
    if(!userDetails.licenses || userDetails.licenses.length == 0) {
        console.log('No user or license found');
        throw new WebError('Access Denied');
    }
    const license = await v2.LicenseDal.get(userDetails.licenses[0]);

    license.abcCollections = request;
    await v2.LicenseDal.save(license);
}
