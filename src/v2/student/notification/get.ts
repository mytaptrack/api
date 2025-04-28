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

export async function handler (data: { studentId: string }, userDetails: WebUserDetails): Promise<typesV2.Notification<typesV2.NotificationDetailsBehavior>[]> {
    console.log('Getting student id');
    const studentId = data.studentId;

    console.log('Checking if user is on students team');
    const teamMember = await v2.TeamDal.getTeamMember(userDetails.userId, studentId);
    if(teamMember.restrictions.data == typesV2.AccessLevel.none) {
        return [];
    }
    
    console.log('Getting notifications');
    const notifications = await v2.UserDal.getStudentBehaviorNotifications(userDetails.userId, studentId);
    WebUtils.logObjectDetails(notifications);
    return notifications.map(n => {
        if(n.details.type != 'behavior') {
            return;
        }
        const bn = n.details as typesV2.NotificationDetailsBehavior;
        return {
            date: n.date,
            details: {
                behaviorId: bn.behaviorId,
                studentId: bn.studentId,
                type: bn.type,
            }
        };
    }).filter(x => x? true : false).map(x => x!);
};
