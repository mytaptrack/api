import { v2, WebUtils, WebError, WebUserDetails } from '@mytaptrack/lib';
import { AccessLevel, StudentNotesPut } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(notesPut, {});

export async function notesPut (request: StudentNotesPut, userDetails: WebUserDetails) {
    console.log('Checking request parameters');
    if(!request.studentId || !request.date) {
        throw new WebError('The request parameters are invalid');
    }
    
    console.log('Checking access');
    const user = await v2.TeamDal.getTeamMember(userDetails.userId, request.studentId);
    WebUtils.logObjectDetails(user.restrictions);
    if(user?.restrictions?.comments != AccessLevel.admin) {
        console.log(`${user?.restrictions?.comments} != ${AccessLevel.admin}`);
        throw new WebError('Access Denied');
    }

    console.log('Updating notes');
    try {
        const existingStorage = await v2.NotesDal.getNotes(request.studentId, request.date);
        await v2.NotesDal.updateNotes(request.studentId, request.date, request.lastModifiedDate, request.updateDate, request.notes);
        let changeIndex = -1;
        const existingNotes = existingStorage?.notes ?? '';
        for(let i = 0; i < request.notes.length && i < existingNotes.length; i++) {
            if(request.notes.charAt(i) != existingNotes.charAt(i)) {
                changeIndex = i;
                break;
            }
        }
        if(changeIndex == -1 && request.notes.length > existingNotes.length) {
            changeIndex = existingNotes.length;
        }
        await v2.NotesDal.sendTaggingEvents(request.notes.slice(changeIndex), 'website', {
            studentId: request.studentId,
            date: request.date,
            userId: userDetails.userId,
            email: ''
        });
    } catch (err) {
        console.log(err.message);
        if(err.message == 'Notes have been added since these notes were retrieved') {
            throw new WebError(err.message);
        }
        throw err;
    }

    return { success: true };
}
