import { v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';

export const handleEvent = WebUtils.apiWrapperEx(deleteEvent, { 
    processBody: 'None', 
    role: 'admins' 
});

export async function deleteEvent(request: string, userDetails: WebUserDetails) {
    if(!request) {
        throw new WebError('Invalid input');
    }
    console.log('Deleting data');
    await v2.LicenseDal.delete(JSON.parse(request));
    console.log('Data deleted');

    console.log('Returning success');
    return { success: true };
}