import { v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { AccessLevel, typesV2 } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    schema: typesV2.DeleteDeviceRequestSchema
});

export async function handler (request: typesV2.DeleteDeviceRequest, userDetails: WebUserDetails) {
    console.log('Getting student id');
    const studentId = request.studentId;

    console.log('Checking if user is on students team');
    const [ team, config ] = await Promise.all([
        v2.TeamDal.getTeamMember(userDetails.userId, studentId),
        v2.DeviceDal.getConfig(studentId, request.dsn)
    ]);
    if(team.restrictions.devices !== AccessLevel.admin && (
        !userDetails.licenses || (config && !userDetails.licenses.find(x => x == config.license)))) {
        throw new WebError('Access Denied');
    }

    if(config && !config.deleted) {
        console.log('Deleting config');
        await v2.DeviceDal.deleteConfig(request.dsn, studentId);
    }
}
