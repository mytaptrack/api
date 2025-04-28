import { AdminAddUserToGroupCommand, CognitoIdentityProviderClient, CreateGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import {
    WebUtils, moment, UserDal, WebError, LicenseDal, LambdaAppsyncQueryClient
} from '@mytaptrack/lib';
import {
    MttAppSyncContext
} from '@mytaptrack/cdk';
import {
    LicenseDetails
} from '@mytaptrack/types';
import { uuid } from 'short-uuid';

export interface AppSyncParams {
    userId: string;
}

export interface LicenseDetailsEx extends LicenseDetails {
    userId: string;
}

export const handler = WebUtils.graphQLWrapper(handleEvent);

export async function handleEvent(context: MttAppSyncContext<AppSyncParams, never, never, never>): Promise<LicenseDetailsEx> {
    console.debug('Event', context);
    const { userId } = context.arguments;
    const user = await UserDal.getUserConfig(userId);
    if(!user) {
        throw new WebError('User not found', 404);
    }

    const license = await LicenseDal.get(user.license);

    console.debug('License Details', license);
    return {
        userId,
        ...license
    };
}
