import { IoTClickType, v2, WebError, WebUserDetails, WebUtils, moment } from '@mytaptrack/lib';
import { AccessLevel, StudentDataExcludeRequest } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(handler, {
});

export async function handler(request: StudentDataExcludeRequest, userDetails: WebUserDetails) {
    console.log('Checking access');
    const user = await v2.TeamDal.getTeamMember(userDetails.userId, request.studentId);
    if(!(user.restrictions.data === AccessLevel.admin)) {
        throw new WebError('Access Denied');
    }

    const weekStart = v2.DataDal.getWeekStart(moment(request.date));
    const weekEnd = weekStart.clone().add(7, 'days');

    console.log('Getting report', weekStart.format('YYYY-MM-DD'), weekEnd.format('YYYY-MM-DD'));
    const dataExists = await v2.DataDal.checkDataExist(request.studentId, weekStart);
    if(!dataExists) {
        console.log('Report not found, creating');
        const studentConfig = await v2.StudentDal.getStudentConfig(request.studentId);
        await v2.DataDal.saveEmptyReport(request.studentId, studentConfig.license,  weekStart, false);
    }
    const report = await v2.DataDal.getData(request.studentId, weekStart, weekEnd);
    
    if(request.action == 'exclude') {
        console.log('Checking exclude days');
        if(!report.excludeDays.find(x => x === request.date)) {
            console.log('Adding to exclude days and saving');
            report.excludeDays.push(request.date);
            await v2.DataDal.setExcludeDays(request.studentId, weekStart, report.excludeDays);
        }
    } else if(request.action == 'include') {
        console.log('Checking include days');
        if(!report.includeDays.find(x => x === request.date)) {
            console.log('Adding to include days and saving');
            report.includeDays.push(request.date);
            await v2.DataDal.setIncludeDays(request.studentId, weekStart, report.includeDays);
        }
    } else {
        console.log('Checking exclude and include days to undo');
        const excludeIndex = report.excludeDays.findIndex(x => x === request.date);
        if(excludeIndex >= 0) {
            console.log('Removing from exclude days and saving');
            report.excludeDays.splice(excludeIndex, 1);
            await v2.DataDal.setExcludeDays(request.studentId, weekStart, report.excludeDays);
        }
        const includeIndex = report.includeDays.findIndex(x => x === request.date);
        if(includeIndex >= 0) {
            console.log('Removing from include days and saving');
            report.includeDays.splice(includeIndex, 1);
            await v2.DataDal.setIncludeDays(request.studentId, weekStart, report.includeDays);
        }
    }

    console.log('Complete');
    return { success: true };
}
