import { v2, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { LicenseDetailsWithUsage } from '@mytaptrack/types';

interface CustomerUsageReport {
    license: string;
    date: string;
    studentsCount: number;
    eventsCount: number;
}

export const handleEvent = WebUtils.apiWrapperEx(getLicense, {processBody: 'None', role: 'admins'});

export async function getLicense(body, user: WebUserDetails) {
    const response = await (v2.LicenseDal.getAll() as Promise<any> as Promise<LicenseDetailsWithUsage[]>);

    return response;
}
