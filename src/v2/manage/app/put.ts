import { LambdaAppsyncQueryClient, WebUserDetails, WebUtils, v2 } from '@mytaptrack/lib';
import { 
    GraphQLAppInput, GraphQLAppStudentInput, QLAppDeviceConfiguration, 
    QLAppStudentSummary, typesV2, QLTag 
} from '@mytaptrack/types';
import { v4 as uuid } from 'uuid';

const appsync = new LambdaAppsyncQueryClient(process.env.appsyncUrl);

export const handleEvent = WebUtils.apiWrapperEx(handler, {
  schema: typesV2.ManageAppRenamePostRequestSchema
});

export async function handler (request: typesV2.ManageAppRenamePostRequest, userDetails: WebUserDetails) {      
    if(userDetails.licenses!.length == 0) {
        throw new Error('No licenses found');
    }

    const result = await appsync.query<QLAppDeviceConfiguration>(`
        query getAppsForDevice($deviceId: String!, $auth: String!, $apps: [AppClaimInput]) {
            getAppsForDevice(deviceId: $deviceId, auth: $auth, apps: $apps) {
                deviceId
                name
                textAlerts
                timezone
                qrExpiration
                studentConfigs {
                    behaviors {
                        id
                        abc
                        order
                        intensity
                    }
                    studentName
                    responses {
                        id
                        abc
                        order
                        intensity
                    }
                    services {
                        id
                        order
                    }
                    groups
                    studentId
                }
            }
        }`,
        {
            deviceId: request.deviceId,
            auth: '',
            apps: []
        }, 'getAppsForDevice');
    // await v2.AppDal.updateAppGlobalPii(request.deviceId, request.license, request.name, request.tags.map(x => ({ type: 'manage', order: 0, tag: x })));

    if(request.reassign) {
        console.info('Adding new unregistered app');
        const newId = `MLC-${uuid().toString()}`;
        await appsync.query(`
            mutation updateApp($appConfig: AppDefinitionInput!) {
                updateApp(appConfig: $appConfig) {
                    deviceId
                }
            }
            `, {
                appConfig: {
                    ...result,
                    tags: [],
                    license: request.license,
                    deviceId: newId,
                } as GraphQLAppInput
            }, 'updateApp');

        console.info('Removing old app');
        await appsync.query(`
            mutation updateApp($appConfig: AppDefinitionInput!) {
                updateApp(appConfig: $appConfig) {
                    deviceId
                }
            }
            `, {
                appConfig: {
                    ...result,
                    tags: [],
                    license: request.license,
                    deleted: true
                } as GraphQLAppInput
            }, 'updateApp');

        return { deviceId: newId };
    //   await v2.AppDal.convertDeviceId(request.license, request.deviceId, `MLC-${uuid().toString()}`)
    } else {
        await appsync.query(`
            mutation updateApp($appConfig: AppDefinitionInput!) {
                updateApp(appConfig: $appConfig) {
                    deviceId
                }
            }
        `, {
            appConfig: {
                deviceId: request.deviceId,
                license: userDetails.licenses![0],
                name: request.name,
                textAlerts: result.textAlerts,
                timezone: result.timezone,
                studentConfigs: [] as GraphQLAppStudentInput[],
                tags: request.tags.map(x => ({ tag: x, type: 'user' } as QLTag)),
            } as GraphQLAppInput
        }, 'updateApp');
    }

    return { device: { id: request.deviceId } };
}
