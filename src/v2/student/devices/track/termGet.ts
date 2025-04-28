import { v2, WebUserDetails, WebUtils} from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';
import { Schema } from 'jsonschema';

const ParameterSchema: Schema = {
    type: 'object',
    properties: {
        studentId: { type: 'string', required: true },
        dsn: { type: 'string', required: true }
    }
};

export const handleEvent = WebUtils.apiWrapperEx(handler, { processBody: 'Parameters', schema: ParameterSchema });

export async function handler (request: { studentId: string, dsn: string }, userDetails: WebUserDetails): Promise<typesV2.TrackDeviceTermStatus> {
    console.log('Getting student id');
    const studentId = request.studentId;

    console.log('Checking if user is on students team');
    const teamMember = await v2.TeamDal.getTeamMember(userDetails.userId, studentId, false);
    if(teamMember.restrictions.devices == typesV2.AccessLevel.none) {
        throw new Error('Access Denied');
    }
    console.log('User is on student team');
    
    const retval = await v2.DeviceDal.getTermStatus(request.dsn, request.studentId);
    return retval;
};
