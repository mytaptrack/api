import {
    WebUtils, getUserPrimaryKey, moment
} from '@mytaptrack/lib';
import {
    MttAppSyncContext
} from '@mytaptrack/cdk';
import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';

const dataDal = new Dal('data');
const primaryDal = new Dal('primary');

export const handler = WebUtils.graphQLWrapper(handleEvent);

export async function handleEvent(context: MttAppSyncContext<{}, never, never, never>): Promise<boolean> {
    console.log('Processing updating app');
    const userId = context.identity.username;

    await dataDal.update({
        key: getUserPrimaryKey(userId),
        updateExpression: 'SET terms = :terms',
        attributeValues: {
            ':terms': moment().toISOString()
        }
    });

    return true;
}
