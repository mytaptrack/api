import {
    WebUtils
} from '@mytaptrack/lib';
import { 
    SystemSettings 
} from '@mytaptrack/types';

import { MttAppSyncContext } from '@mytaptrack/cdk';

export const handler = WebUtils.graphQLWrapper(eventHandler);

export async function eventHandler(context: MttAppSyncContext<{}, any, any, {}>): Promise<SystemSettings> {
    console.log('Getting settings');
    
    const token = `${process.env.appid}://settings?http=https://${process.env.https}&key=${process.env.apikey}&graphql=${process.env.graphql}`;

    return {
        token
    };
}
