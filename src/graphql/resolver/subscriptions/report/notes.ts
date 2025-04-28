import { MttAppSyncContext, WebUtils } from "@mytaptrack/lib";

export const handler = WebUtils.graphQLWrapper(handleEvent);

interface AppSyncParams {
    studentId: string;
}

export async function handleEvent(context: MttAppSyncContext<AppSyncParams, never, never, {}>): Promise<any> {
    console.info(context);
    return null;
}
