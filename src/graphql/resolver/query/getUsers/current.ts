import {
    WebUtils, UserDataStorage, getUserPrimaryKey, UserPrimaryStorage, LicenseStorage, getLicenseKey, UserTeamInviteStorage, UserDal,
    getStudentPrimaryKey, StudentPiiStorage,
    UserStudentTeam
} from '@mytaptrack/lib';
import {
    AccessLevel,
    QLUser, QLUserMajorFeatures,
    UserSummaryStatus, QLUserInvite
} from '@mytaptrack/types';
import { MttAppSyncContext } from '@mytaptrack/cdk';
import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';

const data = new Dal('data');
const primary = new Dal('primary');

interface QueryParams {
    license: string;
}

export const handler = WebUtils.graphQLWrapper(eventHandler);

export async function eventHandler(context: MttAppSyncContext<QueryParams, any, any, {}>): Promise<QLUser> {
    console.log('Getting users');
    const key = getUserPrimaryKey(context.identity.username);
    const [userPii, config, students] = await Promise.all([
        primary.get<UserPrimaryStorage>(key),
        data.get<UserDataStorage>(key),
        data.query<UserStudentTeam>({
            keyExpression: 'pk = :pk and begins_with(sk, :sk)',
            filterExpression: 'attribute_not_exists(#removed) and attribute_not_exists(#deleted)',
            attributeNames: {
                '#removed': 'removed',
                '#deleted': 'deleted'
            },
            attributeValues: {
                ':pk': key.pk,
                ':sk': 'S#'
            },
        })
    ]);

    console.debug('students: ', students);
    const license = config?.license? await data.get<LicenseStorage>(getLicenseKey(config.license)) : undefined;

    let userPiiData: UserPrimaryStorage = userPii;
    let userConfigData: UserDataStorage = config;

    if(!userPii) {
        const email = await UserDal.getEmailByUserId(context.identity.username);
        let emailKey = { pk: `U#${email}`, sk: 'P'};
        const [userPiiEmail, configEmail] = await Promise.all([
            primary.get<UserPrimaryStorage>(emailKey),
            data.get<UserDataStorage>(emailKey)
        ]);
        if(!userPiiEmail) {
            return {
                id: context.identity.username,
                firstName: '',
                lastName: '',
                email,
                name: '',
                state: '',
                zip: '',
                terms: '',
                majorFeatures: {
                    license: '',
                    behaviorTracking: false,
                    serviceTracking: false,
                    tracking: false,
                    manage: false
                },
                invites: []
            };
        }
        userPiiData = userPiiEmail;
        userConfigData = configEmail;
    } else {
        const emailKey = getUserPrimaryKey(userPii.details.email);
        const studentInvites = await data.query<UserStudentTeam>({
            keyExpression: 'pk = :pk and begins_with(sk, :sk)',
            filterExpression: 'attribute_not_exists(#removed) and attribute_not_exists(#deleted)',
            attributeNames: {
                '#removed': 'removed',
                '#deleted': 'deleted'
            },
            attributeValues: {
                ':pk': emailKey.pk,
                ':sk': 'S#'
            },
        });

        students.push(...studentInvites);
    }

    const majorFeatures: QLUserMajorFeatures = {
        license: license? license.license : '',
        behaviorTracking: false,
        serviceTracking: false,
        tracking: false,
        manage: false
    };

    if(license) {
        majorFeatures.behaviorTracking = license.details.features.behaviorTracking? true : false;
        majorFeatures.serviceTracking = license.details.features.serviceTracking? true : false;
        majorFeatures.manage = license.details.features.manage? true : false;
        majorFeatures.tracking = true;
    }

    students?.forEach(x => {
        if(x.behaviorTracking) {
            majorFeatures.behaviorTracking = true;
        }
        if(x.serviceTracking) {
            majorFeatures.serviceTracking = true;
        }
        if(x.restrictions.data == AccessLevel.admin) {
            majorFeatures.tracking = true;
        }
    });

    const invitedStudents = students.filter(x => x.status != UserSummaryStatus.RemovalPending && x.status != UserSummaryStatus.Verified);
    const spiis: StudentPiiStorage[] = invitedStudents.length > 0? await Promise.all(invitedStudents.map(x => primary.get<StudentPiiStorage>(getStudentPrimaryKey(x.studentId), 'firstName,lastName,nickname,studentId'))) : [];

    return {
        id: context.identity.username,
        firstName: userPiiData.details.firstName,
        lastName: userPiiData.details.lastName,
        name: userPiiData.details.name,
        email: userPiiData.details.email,
        state: userPiiData.details.state,
        zip: userPiiData.details.zip,
        terms: userConfigData.terms,
        majorFeatures,
        invites: invitedStudents.map(x => {
            const pii = spiis.find(y => y.studentId == x.studentId);
            return {
                studentId: x.studentId,
                name: pii? (pii.nickname || `${pii.firstName} ${pii.lastName}`) : 'Unknown',
                status: x.status
            } as QLUserInvite;
        })
    };
}
