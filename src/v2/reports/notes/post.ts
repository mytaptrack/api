import { v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { AccessLevel, StudentNotesPost, DailyNote } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(notesPost, {});

export async function notesPost(request: StudentNotesPost, userDetails: WebUserDetails) {
    console.info('Checking request parameters');
    if(!request.studentId || !request.date) {
        throw new WebError('The request parameters are invalid');
    }
    
    console.info('Checking access');
    const user = await v2.TeamDal.getTeamMember(userDetails.userId, request.studentId);
    if(!user || user.restrictions.comments === AccessLevel.none) {
        throw new WebError('Access Denied');
    }

    console.info('Getting notes');
    try {
        let notes = await v2.NotesDal.getNotes(request.studentId, request.date);

        if(!notes) {
            notes = {
                lastUpdate: '01/01/1970',
                notes: ''
            } as DailyNote;
        }

        console.info('Returning notes');
        return notes;
    } catch (err) {
        if(err.code == 'NoSuchKey') {
            console.warn('Returning empty notes');
            return {
                lastUpdate: '01/01/1970',
                notes: ''
            } as DailyNote;
        }

        console.error(err);
        throw new WebError('Internal Error');
    }
}
