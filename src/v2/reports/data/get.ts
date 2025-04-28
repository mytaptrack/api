import { v2, WebError, WebUserDetails, WebUtils, moment } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';
import { Schema } from 'jsonschema';

const ParameterSchema: Schema = {
    type: 'object',
    properties: {
        studentId: { type: 'string', required: true },
        startDate: { type: 'string', required: true },
        endDate: { type: 'string', required: true }
    }
};

export const handleEvent = WebUtils.apiWrapperEx(handler, { processBody: 'Parameters', schema: ParameterSchema });

export async function handler (data: { studentId: string, startDate: string, endDate: string }, userDetails: WebUserDetails): Promise<typesV2.ReportDetails> {
    console.log('Getting student id');
    const studentId = data.studentId;

    console.log('Checking if user is on students team');
    let teamMember: typesV2.UserSummary | undefined;
    try {
        teamMember = await v2.TeamDal.getTeamMember(userDetails.userId, studentId);
    } catch (err) {
        console.log(err);
    }
    if(!teamMember && (userDetails.licenses?.length ?? 0) > 0) {
        const studentConf = await v2.StudentDal.getStudentConfig(data.studentId);
        if(userDetails.licenses!.find(x => x == studentConf?.license)) {
            teamMember = {
                restrictions: {
                    data: typesV2.AccessLevel.admin
                }
            } as any;
        }
    }
    if(!teamMember || teamMember.restrictions.data == typesV2.AccessLevel.none) {
        throw new WebError('Access Denied');
    }
    
    const retval = await v2.DataDal.getData(data.studentId, moment(data.startDate).startOf('day'), moment(data.endDate).endOf('day'));
    if(retval.data) {
        retval.data.sort((a, b) => a.dateEpoc - b.dateEpoc);
    }
    retval.data.forEach(x => {
        if(x.abc && !x.abc.a && !x.abc.c) {
            delete x.abc;
        }
    });
    return retval;
};
