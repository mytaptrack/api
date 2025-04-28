import { v2, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';

interface CustomerUsageReport {
    license: string;
    date: string;
    studentsCount: number;
    eventsCount: number;
}

export const handleEvent = WebUtils.apiWrapperEx(getLicense, {processBody: 'None', role: 'admins'});

export async function getLicense(body, user: WebUserDetails) {
    const response: typesV2.LicenseDetailsWithUsage[] = await (await v2.LicenseDal.getAll()).map(x => x as any as typesV2.LicenseDetailsWithUsage);

    return response;
}
