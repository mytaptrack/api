import { v2, WebError, WebUserDetails, WebUtils, moment } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    processBody: 'Parameters',
    schema: typesV2.StudentTrackStateGetSchema
});

export async function handler(request: typesV2.StudentTrackStateGet, userDetails: WebUserDetails) {
    console.log('Checking access', request);
    const [student, teamMember] = await Promise.all([
        v2.StudentDal.getStudentConfig(request.studentId),
        v2.TeamDal.getTeamMember(userDetails.userId, request.studentId)
    ]);
    WebUtils.logObjectDetails(student);
    if(!teamMember?.restrictions) {
        console.log("User does not have access to student");
        throw new WebError('Access Denied');
    }

    const behaviorIds: string[] = ([] as string[]).concat(
        student.behaviors.filter(b => {
            return b.isDuration && teamMember.restrictions.behavior != typesV2.AccessLevel.none ||
                (
                    teamMember.restrictions.behaviors &&
                    teamMember.restrictions.behaviors.find(x => x == b.id)
                );
            })
            .map(b => b.id!),
        student.responses? student.responses.filter(r => {
            return r.isDuration && teamMember.restrictions.behavior != typesV2.AccessLevel.none ||
            (
                teamMember.restrictions.behaviors &&
                teamMember.restrictions.behaviors.find(x => x == r.id)
            );
        })
        .map(r => r.id) : []
    );
    if(behaviorIds.length == 0) {
        return { behaviorStates:[] };
    }
    
    const nowGMT = moment().startOf('day');
    const now = moment().tz('America/Los_Angeles').startOf('day');
    console.log('Getting report');
    const report = await v2.DataDal.getData(request.studentId, v2.DataDal.getWeekStart(nowGMT), now.clone().add(1, 'day'));
    const nowEpoc = now.toDate().getTime();
    const reportData = report.data.filter(x => nowEpoc <= x.dateEpoc);
    
    console.log('Constructing response');
    return {
        behaviorStates: behaviorIds.map(bId => {
            const data = reportData.filter(x => x.behavior === bId);
            console.log('Result', bId, data.length);
            return {
                behaviorId: bId,
                started: data.length % 2 === 1? true : false,
                startDate: data.length > 0? data[data.length - 1].dateEpoc : undefined
            };
        })
    };
}