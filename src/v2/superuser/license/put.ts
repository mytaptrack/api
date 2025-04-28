import { v2, WebUtils, WebUserDetails, moment } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';
import { v4 as uuid} from 'uuid';

export const handleEvent = WebUtils.apiWrapperEx(create, { 
    role: 'admins',
    schema: typesV2.LicenseDetailsPutSchema
});

export async function create(request: typesV2.LicenseDetails, userDetails: WebUserDetails) {
    if(request.license) {
        const previous = await v2.LicenseDal.get(request.license);

        request.singleUsed = previous.singleUsed;
    } else {
        request.license = moment().format('yyyyMMDD') + uuid().replace(/\-/g, '');
        request.mobileTemplates = [];
        request.studentTemplates = [];
        request.tags = {
            devices: []
        };
        request.abcCollections = [];
    }

    await v2.LicenseDal.save(request);

    return request;
}
