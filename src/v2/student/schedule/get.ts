import { v2, WebUserDetails, WebUtils} from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';
import { Schema } from 'jsonschema';

const ParameterSchema: Schema = {
    type: 'object',
    properties: {
        studentId: { type: 'string', required: true }
    }
};

export const handleEvent = WebUtils.apiWrapperEx(handler, { processBody: 'Parameters', schema: ParameterSchema });

export async function handler (data: any, userDetails: WebUserDetails): Promise<typesV2.ScheduleCategory[]> {
    console.log('Getting student id');
    const studentId = data.studentId;

    console.log('Checking if user is on students team');
    let teamMember: typesV2.UserSummary | undefined;
    try {
        teamMember = await v2.TeamDal.getTeamMember(userDetails.userId, studentId);
    } catch (err) {
    }
    if(!teamMember && (userDetails.licenses?.length ?? 0) > 0) {
        const studentConf = await v2.StudentDal.getStudentConfig(studentId);
        if(userDetails.licenses!.find(x => x == studentConf?.license)) {
            teamMember = {
                restrictions: {
                    schedules: typesV2.AccessLevel.admin
                }
            } as any;
        }
    }
    if(!teamMember?.restrictions?.schedules ||
        teamMember.restrictions.schedules == typesV2.AccessLevel.none) {
        throw new Error('Access Denied');
    }
    
    const retval = await v2.ScheduleDal.getSchedules(data.studentId, new Date().getTime());
    return retval;
};
