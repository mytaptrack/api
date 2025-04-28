import { MttAppSyncContext } from '@mytaptrack/cdk';
import { WebUtils } from '@mytaptrack/lib';
import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';
import { LicenseAppConfigStorage, getAppGlobalV2Key } from '../../types';
import { generateToken, getTokenKey } from '../../../../v2/student/devices/app/token-utils';
import { v4 as uuid } from 'uuid';

export const handler = WebUtils.graphQLWrapper(handleEvent);

const data = new Dal('data');
const primary = new Dal('primary');

interface AppSyncParams {
    license: string;
    deviceId: string;
    expiration: number;
}

export async function handleEvent(context: MttAppSyncContext<AppSyncParams, any, any, any>): Promise<any> {
    const license = context.arguments.license;
    const deviceId = context.arguments.deviceId;
    const expiration = context.arguments.expiration;

    console.info('Getting apps for ', license);
    const globalKey = getAppGlobalV2Key(license, deviceId);

    const [deviceConfig] = await Promise.all([
        data.get<LicenseAppConfigStorage>(globalKey)
    ]);

    if(!deviceConfig.auth || deviceConfig.auth.length == 0) {
        deviceConfig.auth = [uuid()];
    }

    console.log('Constructing token', deviceConfig.deviceId);
    const key = await getTokenKey();
    const result = await generateToken(deviceConfig.deviceId, deviceConfig.auth[0], key);

    return { deviceId, token: `${process.env.appid}://student?token=${result}` };
}
