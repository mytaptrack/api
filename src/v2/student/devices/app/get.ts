import { AppStoredObject, LambdaAppsyncQueryClient, v2, WebUserDetails, WebUtils} from '@mytaptrack/lib';
import { QLAppDeviceConfiguration, typesV2 } from '@mytaptrack/types';
import { Schema } from 'jsonschema';

const ParameterSchema: Schema = {
    type: 'object',
    properties: {
        studentId: { type: 'string', required: true },
        appId: { type: 'string', required: true },
        deviceId: { type: 'string', required: true }
    }
};

const appsync = new LambdaAppsyncQueryClient(process.env.appsyncUrl);

export const handleEvent = WebUtils.apiWrapperEx(handler, { processBody: 'Parameters', schema: ParameterSchema });

export async function handler (data: { studentId: string, appId: string, deviceId?: string }, userDetails: WebUserDetails): Promise<typesV2.IoTDevice> {
    console.log('Getting student id');
    const studentId = data.studentId;

    console.log('Checking if user is on students team');
    const teamMember = await v2.TeamDal.getTeamMember(userDetails.userId, studentId);
    if(teamMember.restrictions.devices == typesV2.AccessLevel.none) {
        throw new Error('Access Denied');
    }
    
    let license;
    if(!data.deviceId || data.appId == data.deviceId) {
        const conf = await v2.AppDal.getAppConfig(studentId, data.appId);
        data.deviceId = conf.deviceId;
        license = conf.license
    }
    console.log('User is on student team');
    if(!license) {
        const student = await v2.StudentDal.getStudentConfig(studentId);
        license = student.license;
    }

    console.info('Getting app');
    const result = await appsync.query<QLAppDeviceConfiguration>(`
            query getAppsForDevice($deviceId: String!, $auth: String!, $apps: [AppClaimInput]) {
                getAppsForDevice(deviceId: $deviceId, auth: $auth, apps: $apps) {
                    deviceId
                    identity
                    qrExpiration
                    studentConfigs {
                    abc {
                        antecedents
                        consequences
                        name
                        tags
                        overwrite
                    }
                    behaviors {
                        id
                        isDuration
                        name
                        abc
                        order
                        intensity
                    }
                    studentName
                    responses {
                        id
                        isDuration
                        name
                        abc
                    }
                    services {
                        abc
                        name
                        isDuration
                        id
                    }
                    studentId
                    }
                    timezone
                }
            }
        `,
        {
            deviceId: data.deviceId,
            auth: '',
            apps: []
        }, 'getAppsForDevice');


    console.info('Converting app');
    return appToIoT(result, studentId, data.deviceId);
};

export function appToIoT(app: QLAppDeviceConfiguration, studentId: string, deviceId?: string): typesV2.IoTAppDevice {
    const studentApp = app.studentConfigs.find(x => x.studentId == studentId);
    console.log('Getting data for retval');
    return {
        dsn: deviceId ?? app.deviceId,
        deviceId: deviceId ?? app.deviceId!,
        studentId: studentApp.studentId,
        license: app.license,
        deviceName: app.name,
        studentName: studentApp.studentName,
        events: [
            studentApp.behaviors.map(y => ({
                eventId: y.id,
                presses: undefined,
                delayDelivery: undefined,
                track: true,
                abc: y.abc? true : undefined,
                order: y.order
            } as typesV2.IoTDeviceEvent)),
            studentApp.responses.map(y=> ({
                eventId: y.id,
                presses: undefined,
                delayDelivery: undefined,
                track: true,
                abc: y.abc? true : undefined,
                order: y.order
            } as typesV2.IoTDeviceEvent))
        ].flat()
        .sort((a, b) => a.order - b.order),
        groups: studentApp.groups,
        textAlerts: app.textAlerts,
        validated: (deviceId ?? app.deviceId)?.startsWith('MLC-') ? false : true,
        multiStudent: true,
        commands: undefined as any,
        timezone: app.timezone!,
        isApp: true
    };
}
