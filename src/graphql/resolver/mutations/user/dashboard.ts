import { MttAppSyncContext } from '@mytaptrack/cdk';
import { 
    StudentDashboardSettingsStorage,
    WebUtils
} from '@mytaptrack/lib';
import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';
import {
    QLUserSummary,
    StudentDashboardSettings
} from '@mytaptrack/types';

interface AppSyncParams {
  studentId: string;
  dashboard?: StudentDashboardSettings;
}

const data = new Dal('data');
/**
 * Request a single item with `id` from the attached DynamoDB table datasource
 * @param event the context object holds contextual information about the function invocation.
 */

export const handler = WebUtils.graphQLWrapper(handleEvent);

export async function handleEvent(context: MttAppSyncContext<AppSyncParams, never, never, {}>): Promise<StudentDashboardSettings> {
    console.log('updateService data.request', context);
    const license = context.stash.permissions.license;
    const studentId = context.arguments.studentId;
    const userId = context.identity.username;
    const key = { 
        pk: `S#${studentId}`, 
        sk: `D#${userId}#DA` 
    };
    if(context.arguments.dashboard) {
        data.put({
            pk: key.pk,
            sk: key.sk,
            pksk: `${key.pk}#${key.sk}`,
            studentId: studentId,
            tsk: `U#${userId}#DA`,
            userId: userId,
            usk: `S#${studentId}#DA`,
            license,
            lpk: `${license}#S`,
            lsk: `DA#${studentId}`,
            dashboard: context.arguments.dashboard!,
            version: 1
        } as StudentDashboardSettingsStorage);
    } else {
        data.delete(key);
    }

    return context.arguments.dashboard;
}
