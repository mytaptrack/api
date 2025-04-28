import { v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { AccessLevel, PutSettingsRequest, PutSettingsRequestSchema } from '@mytaptrack/types';
import { colors } from '../../student/info/get';

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    schema: PutSettingsRequestSchema
});

export async function handler(request: PutSettingsRequest, userDetails: WebUserDetails) {
    if(request['success'] || request.settings['success']) {
        throw new WebError('Invalid data model');
    }
    console.log('Checking access');
    const user = await v2.TeamDal.getTeamMember(userDetails.userId, request.studentId);
    if(user.restrictions.data !== AccessLevel.admin ||
        user.restrictions.schedules === AccessLevel.none) {
        throw new WebError('Access Denied');
    }

    request.settings.behaviors?.forEach((b, i) => {
        if(typeof b.frequency == 'boolean') {
            b.frequency = colors[i % colors.length][0];
        }
        if(b.duration) {
            Object.keys(b.duration).forEach((k, i) => {
                if(typeof b.duration[k] == 'boolean' && b.duration[k]) {
                    b.duration[k] = colors[i % colors.length][i + 1];
                }
            });
        }
    });

    if(request.overwriteStudent) {
        console.log('Saving student dashboard');
        await v2.StudentDal.saveStudentDashboard(request.studentId, request.settings);
    } else {
        console.log('Saving user dashboard');
        const student = await v2.StudentDal.getStudentConfig(request.studentId);
        await v2.StudentDal.saveUserDashboard(request.studentId, student.license, userDetails.userId, request.settings);
    }

    return { success: true };
}
