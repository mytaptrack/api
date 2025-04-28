import { WebUtils, WebUserDetails, v2 } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';
import { install } from 'source-map-support';
install();

export const get = WebUtils.apiWrapperEx(userGet, { processBody: 'None' });

export async function userGet(request: string, userDetails: WebUserDetails) {
    console.log('Getting summary for user: ' + userDetails.userId);
    WebUtils.logObjectDetails(process.env);
    let user = await v2.UserDal.getUser(userDetails.userId, userDetails.email);

    let license: string | undefined = userDetails.licenses? userDetails.licenses[0] : undefined;
    console.log('user retrieved');
    if(!user) {
        let licenseDetails: typesV2.LicenseDetails | undefined;
        if(license) {
            licenseDetails = await v2.LicenseDal.get(license);
        }
        console.log('User data was not setup');
        user = {
            userId: userDetails.userId,
            details: {
                email: userDetails.email,
                name: userDetails.name,
                firstName: '',
                lastName: '',
                state: '',
                zip: '',
            },
            license,
            licenseDetails,
            teamInvites: [],
            students: [],
            terms: '',
            version: 1
        } as typesV2.User;
        await Promise.all([
            v2.UserDal.saveUserPii(userDetails.userId, license!, user.details),
            v2.UserDal.saveUserConfig(userDetails.userId, {
                tags: [],
                license,
                licenseDetails
            })
        ]);
    } else if(license && !user.licenseDetails) {
        let licenseDetails: typesV2.LicenseDetails;
        licenseDetails = await v2.LicenseDal.get(license);
        user.licenseDetails = licenseDetails;
        await Promise.all([
            v2.UserDal.saveUserPii(userDetails.userId, license, user.details),
            v2.UserDal.saveUserConfig(userDetails.userId, {
                tags: [],
                license,
                licenseDetails
            })
        ]);
    }

    return user;
}
