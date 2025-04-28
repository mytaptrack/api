import { WebUserDetails, WebUtils, v2 } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx<typesV2.ManageStudentTemplatePutRequest>(handler, { });

export async function handler (request: any, userDetails: WebUserDetails) {
    if(!userDetails.licenses || userDetails.licenses.length == 0) {
        return {
            apps: [],
            student: []
        };
    }
    const license = await v2.LicenseDal.get(userDetails.licenses[0]);
    return {
        apps: license.mobileTemplates,
        student: license.studentTemplates
    };
}
