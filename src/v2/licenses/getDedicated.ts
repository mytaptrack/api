import { LicenseDal, TeamDal, UserDal, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { AccessLevel, ApplyLicenseRequest, UserDetails } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(post, {});

export async function post(request: ApplyLicenseRequest, user: WebUserDetails) {
    if(!user.licenses?.find(x => x == request.license)) {
        throw new WebError('Access Denied');
    }
    
    console.log('Getting license');
    const license = await LicenseDal.get(request.license);
    if(!license) {
        throw new WebError('License not found');
    }
    
    return license.singleUsed;
}