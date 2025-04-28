import { LambdaAppsyncQueryClient, v2, WebUserDetails, WebUtils} from '@mytaptrack/lib';
import { QLAppDeviceConfiguration, typesV2 } from '@mytaptrack/types';
import { Schema } from 'jsonschema';
import { generateToken, getTokenKey } from './token-utils';
import { handler as qrHandler } from './qrCodeGet';

const appsync = new LambdaAppsyncQueryClient(process.env.appsyncUrl);

const ParameterSchema: Schema = {
    type: 'object',
    properties: {
        studentId: { type: 'string' },
        appId: { type: 'string' }
    },
    required: ['studentId', 'appId']
};

export const handleEvent = WebUtils.apiWrapperEx(handler, { processBody: 'Parameters', schema: ParameterSchema });

export async function handler(data: { studentId: string, appId: string }, userDetails: WebUserDetails): Promise<{ appId: string, token: string }> {
    console.log('Getting student id');

    return await qrHandler(data, userDetails);
};
