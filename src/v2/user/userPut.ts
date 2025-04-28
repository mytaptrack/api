import { typesV2, UserPutRequest } from '@mytaptrack/types';
import { v2, WebUserDetails, WebUtils, moment } from '@mytaptrack/lib';
import { install } from 'source-map-support';
install();

export const put = WebUtils.apiWrapperEx(
    userPut, 
    { 
        ignoreMissingUserError: true, 
        schema: typesV2.UserPutRequestSchema 
    });

export async function userPut(request: UserPutRequest, userDetails: WebUserDetails) {
    console.log('Getting user');
    let user = await v2.UserDal.getUser(userDetails.userId, userDetails.email);
    if(!user) {
        console.log('User not found');
        user = {
            userId: userDetails.userId,
            details: {
                reportNames: {}
            } as any,
            reports: [],
            version: 4
        } as any;
    }
    
    user.details.name = request.name;
    user.details.firstName = request.firstName;
    user.details.lastName = request.lastName;
    user.details.state = request.state;
    user.details.zip = request.zip;
    user.details.email = userDetails.email;
    
    let configPromise;
    if(request.acceptTerms == true) {
        user.terms = moment().toISOString();
        let config = await v2.UserDal.getUserConfig(userDetails.userId);
        if(!config) {
            config = {
                tags: [],
                events: [],
                terms: user.terms,
                license: '',
                majorFeatures: [
                    {
                        license: user.license,
                        behaviorTracking: true,
                        serviceTracking: false,
                        tracking: true,
                        manage: userDetails.licenses.find(x => x.startsWith('license/'))? true : false
                    }
                ],
                licenseDetails: {
                    license: '',
                    customer: '',
                    singleCount: 0,
                    singleUsed: 0,
                    multiCount: 0,
                    admins: [],
                    emailDomain: '',
                    expiration: '',
                    start: '',
                    tags: {
                        devices: []
                    }
                }
            };
            configPromise = v2.UserDal.saveUserConfig(userDetails.userId, config);
        }
    }
    
    await Promise.all([
        v2.UserDal.saveUserPii(userDetails.userId, '', user.details),
        configPromise
    ]);
    return user;
}
