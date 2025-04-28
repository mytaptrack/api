import { v4 as uuid} from 'uuid';
import { v2, WebUtils, WebUserDetails, WebError } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx<typesV2.StudentBehaviorDeleteRequest>(handler, {
    schema: typesV2.StudentBehaviorDeleteRequestSchema
});

export async function handler(request: typesV2.StudentBehaviorDeleteRequest, userDetails: WebUserDetails) {
    console.log('Getting user data');
    const user = await v2.TeamDal.getTeamMember(userDetails.userId, request.studentId, false);
    if(!user || user.restrictions.behavior !== typesV2.AccessLevel.admin ) {
        throw new WebError('Access Denied');
    }
    let student = await v2.StudentDal.getStudent(request.studentId, userDetails.userId);
    
    console.log('Checking if behavior is present')
    const behaviorIndex = student.behaviors.findIndex(behavior => behavior.id == request.behaviorId);
    if(behaviorIndex < 0){
        throw new WebError('The specified behavior is not found');
    }
    student.behaviors.splice(behaviorIndex, 1);
    await v2.StudentDal.saveStudent(student);
    console.log('Save complete');
}
