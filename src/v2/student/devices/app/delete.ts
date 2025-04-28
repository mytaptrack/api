import { LambdaAppsyncQueryClient, v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { AccessLevel, GraphQLAppInput, QLAppDeviceConfiguration, typesV2 } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    schema: typesV2.DeleteDeviceRequestSchema
});

const appsync = new LambdaAppsyncQueryClient(process.env.appsyncUrl);

export async function handler (request: typesV2.DeleteDeviceRequest, userDetails: WebUserDetails) {
    console.log('Getting student id');
    const studentId = request.studentId;

    console.log('Checking if user is on students team');
    const team = await v2.TeamDal.getTeamMember(userDetails.userId, studentId);
    if(team.restrictions.devices !== AccessLevel.admin && (
        !userDetails.licenses || (!userDetails.licenses.find(x => x == team.license)))) {
        throw new WebError('Access Denied');
    }
    console.debug('team', team);

    console.info('Getting apps for device');
    const app = await appsync.query<QLAppDeviceConfiguration>(`
    query getAppsForDevice($deviceId: String!) {
        getAppsForDevice(deviceId: $deviceId, auth: "", apps: []) {
          deviceId
          name
          studentConfigs {
            behaviors {
              id
              abc
              order
            }
            studentName
            responses {
              id
              abc
              order
            }
            services {
              id
              order
            }
            groups
            studentId
          }
        }
    }
        `,
        {
            deviceId: request.dsn
        }, 'getAppsForDevice');

    console.info('Finding student in app');
    const studentConf = app.studentConfigs.find(x => x.studentId == studentId);
    if(!studentConf) {
        console.info('No student config found for studentId');
        return;
    }
    
    console.debug('studentConf', studentConf);
    await appsync.query(`
        mutation updateApp($appConfig: AppDefinitionInput!) {
            updateApp(appConfig: $appConfig) {
                deviceId
            }
        }`,
        {
        appConfig: {
            deviceId: app.deviceId,
            license: team.license,
            name: app.name,
            textAlerts: app.textAlerts,
            studentConfigs: [
                {
                    studentId: studentConf.studentId,
                    studentName: studentConf.studentName,
                    groups: studentConf.groups,
                    behaviors: studentConf.behaviors,
                    responses: studentConf.responses,
                    services: studentConf.services,
                    delete: true,
                }
            ],
            timezone: app.timezone,
            tags: []
        } as GraphQLAppInput
        }, 'updateApp');
}