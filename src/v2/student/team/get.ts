import { v2, WebUserDetails, WebUtils} from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';
import { Schema } from 'jsonschema';

const ParameterSchema: Schema = {
    type: 'object',
    properties: {
        studentId: { type: 'string', required: true },
    }
};

export const handleEvent = WebUtils.apiWrapperEx(handler, { processBody: 'Parameters', schema: ParameterSchema });

export async function handler (data: { studentId: string }, userDetails: WebUserDetails): Promise<typesV2.UserSummary[]> {
    console.log('Getting student id');
    const studentId = data.studentId;

    console.log('Checking if user is on students team');
    const teamMember = await v2.TeamDal.getTeamMember(userDetails.userId, studentId);
    if(teamMember.restrictions.devices == typesV2.AccessLevel.none) {
        throw new Error('Access Denied');
    }
    
    const team = await v2.TeamDal.getTeam(studentId);
    return team;
};
