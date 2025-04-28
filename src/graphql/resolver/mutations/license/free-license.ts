import { AdminAddUserToGroupCommand, CognitoIdentityProviderClient, CreateGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import {
    WebUtils, moment, UserDal, WebError, LicenseDal, LambdaAppsyncQueryClient, getUserPrimaryKey
} from '@mytaptrack/lib';
import {
    MttAppSyncContext
} from '@mytaptrack/cdk';
import {
    LicenseDetails,
    PersonalSubscriptionType
} from '@mytaptrack/types';
import { uuid } from 'short-uuid';
import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';
import { LicenseDetailsEx } from './license-updated';

export interface AppSyncParams {
}

const data = new Dal('data');
const cognito = new CognitoIdentityProviderClient({});
const appsync = new LambdaAppsyncQueryClient(process.env.appsyncUrl);

export const handler = WebUtils.graphQLWrapper(handleEvent);

export async function handleEvent(context: MttAppSyncContext<AppSyncParams, never, never, never>): Promise<LicenseDetailsEx> {
    console.debug('Event', context);

    const user = await UserDal.getUser(context.identity.username, '');
    if(!user) {
        throw new WebError('User not found', 403);
    }
    
    let license: LicenseDetails;
    if(user.license) {
        console.info('Getting license');
        license = await LicenseDal.get(user.license);
    } else {
        console.info('Creating new license');
        license = {
            abcCollections: [],
            admins: [user.details.email.toLocaleLowerCase().trim()],
            customer: `PER-${user.details.state.trim()}-${user.userId?.trim()}`,
            emailDomain: '',
            expiration: moment('2099-01-01').format('yyyy-MM-DD'),
            features: {
                snapshot: false,
                snapshotConfig: {
                    low: '@frown',
                    medium: '@meh',
                    high: '@smile',
                    measurements: [{name: '@smile', order: 0}, {name: '@meh', order: 1}, {name: '@frown', order: 2}]
                },
                dashboard: true,
                browserTracking: true,
                download: false,
                duration: false,
                manage: false,
                supportChanges: false,
                schedule: false,
                devices: true,
                behaviorTargets: false,
                response: false,
                emailTextNotifications: true,
                manageStudentTemplates: false,
                manageResponses: false,
                abc: false,
                notifications: false,
                appGroups: false,
                documents: false,
                intervalWBaseline: false,
                displayTags: [],
                serviceTracking: false,
                behaviorTracking: true,
                serviceProgress: false,
                personal: PersonalSubscriptionType.free
            },
            license: moment().format('yyyyMMDD') + uuid().replace(/\-/g, ''),
            multiCount: 0,
            singleCount: 2,
            singleUsed: 0,
            start: moment().format('yyyy-MM-DD'),
            mobileTemplates: [],
            studentTemplates: [],
            tags: {
                devices: []
            }
        };

        await data.update({
            key: getUserPrimaryKey(user.userId!),
            updateExpression: 'SET #license = :license',
            attributeValues: {
                ':license': license.license
            },
            attributeNames: {
                '#license': 'license'
            }
        });

        const group = await cognito.send(new CreateGroupCommand({
            UserPoolId: process.env.UserPoolId!,
            GroupName: `licenses/${license.license}`
        }));

        await cognito.send(new AdminAddUserToGroupCommand({
            UserPoolId: process.env.UserPoolId!,
            Username: user.userId!,
            GroupName: group.Group.GroupName,
        }));
        
        await LicenseDal.save(license);
    }

    return {
        userId: user.userId,
        ...license
    };
}
