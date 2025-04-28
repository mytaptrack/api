import { WebUserDetails, WebUtils, v2, moment, LambdaAppsyncQueryClient, StudentDal } from '@mytaptrack/lib';
import { GraphQLAppInput, QLAppDeviceConfiguration, typesV2 } from '@mytaptrack/types';

const appsync = new LambdaAppsyncQueryClient(process.env.appsyncUrl);

export const handleEvent = WebUtils.apiWrapperEx(handler, {
  schema: typesV2.DeleteDeviceRequestSchema
});

export async function handler(request: typesV2.DeleteDeviceRequest, userDetails: WebUserDetails) {
  if (userDetails.licenses!.length == 0) {
    throw new Error('No licenses found');
  }

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
  console.debug('app.studentConfigs', app.studentConfigs, 'studentId ', request.studentId);
  if (request.studentId || app.studentConfigs.length > 0) {
    const studentConf = app.studentConfigs.find(x => x.studentId == request.studentId);
    if (!studentConf) {
      console.info('No student config found for studentId');
      return;
    }

    const studentData = await StudentDal.getStudentConfig(studentConf.studentId);

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
          license: studentData.license,
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
  } else {
    console.log('Removing device');
    const deleteConfig = {
      deviceId: app.deviceId,
      license: userDetails.licenses[0],
      name: app.name,
      textAlerts: app.textAlerts,
      studentConfigs: [],
      timezone: app.timezone,
      tags: [],
      deleted: true
    } as GraphQLAppInput;
    console.log('Delete config', deleteConfig);
    
    await appsync.query(`
        mutation updateApp($appConfig: AppDefinitionInput!) {
            updateApp(appConfig: $appConfig) {
                deviceId
            }
        }`,
      {
        appConfig: deleteConfig
      }, 'updateApp');
  }
}
