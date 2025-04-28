import { LambdaAppsyncQueryClient, v2, WebUserDetails, WebUtils} from '@mytaptrack/lib';
import { QLAppSummary, typesV2 } from '@mytaptrack/types';
import { IoTAppDevice } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(studentGet, { processBody: 'Parameters' });

const appsync = new LambdaAppsyncQueryClient(process.env.appsyncUrl);

function cleanFields(obj: any) {
    if(!obj) {
        return obj;
    }

    Object.keys(obj).forEach(key => {
        if(obj[key] === undefined || obj[key] === null) {
            delete obj[key];
        }
    });

    return obj;
}

export async function studentGet (data: any, userDetails: WebUserDetails): Promise<typesV2.IoTDevice[]> {
    console.log('Getting student id');
    const studentId = data.studentId;

    console.log('Checking if user is on students team');
    const teamMember = await v2.TeamDal.getTeamMember(userDetails.userId, studentId);
    if(teamMember.restrictions.devices == typesV2.AccessLevel.none) {
        throw new Error('Access Denied');
    }
    
    if(!teamMember.license) {
        return [];
    }

    console.log('User is on student team');
    const [apps, devices] = await Promise.all([
        appsync.query<QLAppSummary[]>(`
            query getAppList($license: String!, $studentId: String) {
                getAppList(license: $license, studentId: $studentId) {
                    name
                    deviceId
                    studentName
                    behaviors {
                        abc
                        intensity
                        id
                        order
                    }
                }
            }`,
            { license: teamMember.license, studentId },
            'getAppList'
        ),
        v2.DeviceDal.getStudentDevices(studentId)
    ]);

    WebUtils.logObjectDetails(apps);
    console.log(`Apps: ${apps.length}, Track2.0: ${devices.length}`);

    const retval = ([] as typesV2.IoTDevice[]).concat(
        apps.map(app => ({
            dsn: app.deviceId,
            studentId: app.studentId,
            deviceId: app.deviceId,
            license: teamMember.license,
            studentName: app.studentName,
            deviceName: app.name ?? 'Mytaptrack App',
            events: (app.behaviors || []).map(event => cleanFields({
                eventId: event.id,
                presses: undefined,
                delayDelivery: undefined,
                track: true,
                abc: event.abc? true : undefined,
                intensity: event.intensity,
                order: event.order
            } as typesV2.IoTDeviceEvent)),
            groups: app.groups,
            textAlerts: app.textAlerts,
            expiration: undefined,
            validated: app.deviceId.startsWith('MLC')? false : true,
            multiStudent: true,
            commands: undefined as any,
            timezone: '',
            isApp: true
        } as IoTAppDevice)),
        devices.map(track2 => ({
            dsn: track2.dsn,
            studentId: track2.studentId,
            deviceId: track2.dsn,
            license: track2.license,
            deviceName: track2.deviceName ?? 'Track 2.0',
            events: track2.events,
            expiration: undefined,
            validated: track2.validated,
            multiStudent: true,
            commands: track2.commands,
            timezone: track2.timezone,
            isApp: false
        } as typesV2.IoTDevice))
    );

    console.debug('retval', retval);
    return retval;
};
