import { LambdaAppsyncQueryClient, v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { AccessLevel, GraphQLAppInput, QLAppDeviceConfiguration, typesV2 } from '@mytaptrack/types';
import shortUUID = require('short-uuid');
import { v4 as uuid } from 'uuid';
import { appToIoT } from './get';

const appsync = new LambdaAppsyncQueryClient(process.env.appsyncUrl);

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    schema: typesV2.AppPutRequestSchema
});

export async function handler(request: typesV2.AppPutRequest, userDetails: WebUserDetails) {
    console.log('Getting student id', request);
    const studentId = request.studentId;

    console.log('Checking if user is on students team');
    const [student, config] = await Promise.all([
        v2.StudentDal.getStudent(studentId, userDetails.userId),
        v2.AppDal.getAppConfig(studentId, request.dsn)
    ]);
    const isLicenseAdmin = student?.license && userDetails.licenses.includes(student.license);
    if (!isLicenseAdmin && student.restrictions.devices !== AccessLevel.admin) {
        throw new WebError('Access Denied');
    }

    let generatingUserId;
    if (config && config.deviceId) {
        request.deviceId = config.deviceId;
    } else {
        generatingUserId = userDetails.userId;
    }
    const device: { deviceId: string } = await appsync.query<{ deviceId: string }>(`
        mutation updateApp($appConfig: AppDefinitionInput!) {
            updateApp(appConfig: $appConfig) {
                deviceId
            }
        }`, {
        appConfig: {
            deviceId: request.deviceId ?? request.dsn,
            license: student.license ?? userDetails.licenses![0],
            name: request.deviceName,
            textAlerts: request.textAlerts,
            studentConfigs: [
                {
                    studentId,
                    studentName: request.studentName,
                    groups: request.groups ?? [],
                    behaviors: request.events
                        .filter(x => x && x.track && student.behaviors.find(y => y.id == x.eventId))
                        .map(x => ({
                            id: x.eventId,
                            abc: x.abc,
                            intensity: x.intensity,
                            order: x.order
                        })),
                    responses: request.events
                        .filter(x => x && x.track && student.responses.find(y => y.id == x.eventId))
                        .map(x => ({
                            id: x.eventId,
                            abc: x.abc,
                            order: x.order
                        })),
                    services: []
                }
            ],
            tags: []
        } as GraphQLAppInput
    }, 'updateApp');

    console.debug('Update response', device);
    request.deviceId = device?.deviceId ?? request.deviceId;

    const result = await appsync.query<QLAppDeviceConfiguration>(`
        query getAppsForDevice($deviceId: String!, $auth: String!, $apps: [AppClaimInput]) {
            getAppsForDevice(deviceId: $deviceId, auth: $auth, apps: $apps) {
                deviceId
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
                    intensity
                    order
                }
                studentName
                responses {
                    id
                    isDuration
                    name
                    abc
                    order
                }
                services {
                    id
                    name
                    notStopped
                    order
                    percentage
                    trackedItems
                    modifications
                }
                studentId
                }
                timezone
            }
        }
        `,
        {
            deviceId: request.deviceId,
            auth: '',
            apps: []
        }, 'getAppsForDevice');

    console.log('Getting data for retval');
    console.debug('result: ', result);
    return appToIoT(result, studentId);
}
