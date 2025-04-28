import { getStudentPrimaryKey, LambdaAppsyncQueryClient, StudentPiiStorage, v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { MobileDevice, QLApp, QLAppDeviceConfiguration } from '@mytaptrack/types';
// import { type LicenseAppConfigStorage, type LicenseAppPiiStorage } from '../../../graphql/resolver/types/app-storage';
import { Dal, DalKey } from '@mytaptrack/lib/dist/v2/dals/dal';

export const handleEvent = WebUtils.apiWrapperEx<any>(handler, { processBody: 'None' });
const primary = new Dal('primary');
const data = new Dal('data');

const appsync = new LambdaAppsyncQueryClient(process.env.appsyncUrl);

export async function handler (request: any, userDetails: WebUserDetails): Promise<MobileDevice[]> {      
    if(!userDetails.licenses || userDetails.licenses.length == 0) {
        throw new WebError('Access Denied');
    }

    const license = userDetails.licenses[0];
    console.log('Getting apps for license', license);
    console.info('Getting apps for ', userDetails.licenses[0]);
    
    const appResults = await appsync.query<QLApp[]>(`
        query getAppsForLicense($license: String!) {
            getAppsForLicense(license: $license) {
                deviceId
                license
                name
                studentConfigs {
                    behaviors {
                        abc
                        id
                        name
                        order
                    }
                    groups
                    services {
                        id
                        name
                        order
                    }
                    studentId
                    studentName
                }
                tags {
                    tag
                    type
                }
                textAlerts
                timezone
            }
        }
        `,
        {
            license,
        }, 'getAppsForLicense');

    console.info('Pii retrieved', appResults.length);
    const retval: MobileDevice[] = appResults.map(device => {
        console.info('App retrieved', device.deviceId);
        console.debug('device', device);
        return {
            appId: device.deviceId,
            device: {
                id: device.deviceId,
                name: device.name
            },
            assignments: device.studentConfigs?.map(s => {
                return {
                    id: s.studentId,
                    studentId: s.studentId,
                    timezone: device.timezone,
                    behaviors: s.behaviors.map(b => (
                        {
                            id: b.id,
                            abc: b.abc,
                            order: b.order,
                            title: b.name,
                            track: true
                        }
                    )) ?? [],
                    name: s.studentName,
                    groups: s.groups ?? []
                };
            }).filter(x => x? true : false).map(x => x!) ?? [],
            tags: device.tags?.map(x => x.tag) ?? []
        } as MobileDevice;
    });

    console.info('Results constructed', retval.length);

    retval.sort((a, b) => a.device.name.localeCompare(b.device.name));

    console.debug('retval', retval);

    return retval;
}
