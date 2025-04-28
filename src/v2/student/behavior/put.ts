import { v4 as uuid} from 'uuid';
import { WebUtils, WebUserDetails, WebError, TeamDal, StudentDal } from '@mytaptrack/lib';
import { 
    StudentBehaviorPutRequest, StudentBehaviorPutRequestSchema, StudentBehavior, AccessLevel
} from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx<StudentBehaviorPutRequest>(putBehavior, {
    schema: StudentBehaviorPutRequestSchema
});

export async function putBehavior(request: StudentBehaviorPutRequest, userDetails: WebUserDetails) {
    console.debug('request', request);
    console.log('Getting user data');
    const user = await TeamDal.getTeamMember(userDetails.userId, request.studentId, false);
    if(!user || user.restrictions.behavior !== AccessLevel.admin ) {
        throw new WebError('Access Denied');
    }
    let student = await StudentDal.getStudent(request.studentId, userDetails.userId);
    
    let behaviorFromId: StudentBehavior | undefined;
    console.log('Checking if behavior is present')
    if (request.behavior.id){
        behaviorFromId = student.behaviors.find(behavior => behavior.id == request.behavior.id);
        if(!behaviorFromId){
            throw new WebError('The specified behavior is not found');
        }
    } else if (student.behaviors.find(behavior => behavior.name.toLowerCase().trim() == request.behavior.name.toLowerCase().trim())) {
        console.log(`The behavior is already present for student ${request.studentId}`);
        throw new WebError('The specified behavior is already present');
    }
    let newBehavior = behaviorFromId;
    if(!behaviorFromId) {
        console.log('Adding behavior to student');
        newBehavior = {
            name: request.behavior.name,
            isArchived: false,
            isDuration: request.behavior.isDuration,
            baseline: request.behavior.baseline,
            targets: request.behavior.targets,
            desc: request.behavior.desc,
            daytime: request.behavior.isDuration && request.behavior.daytime === undefined? true : request.behavior.daytime,
            id: uuid(),
            requireResponse: request.behavior.requireResponse,
            tags: [],
            trackAbc: request.behavior.trackAbc,
            intensity: request.behavior.intensity
        };
        student.behaviors.push(newBehavior);
    } else {
        console.log('Updating behavior for student');
        WebUtils.logObjectDetails(request.behavior.targets);
        behaviorFromId.name = (request.behavior.name)? request.behavior.name : behaviorFromId.name;
        behaviorFromId.isArchived = (request.behavior.isArchived !== undefined)? request.behavior.isArchived : behaviorFromId.isArchived;
        behaviorFromId.isDuration = (request.behavior.isDuration !== undefined)? request.behavior.isDuration : behaviorFromId.isDuration;
        behaviorFromId.targets = request.behavior.targets;
        behaviorFromId.desc = request.behavior.desc;
        behaviorFromId.daytime = request.behavior.isDuration && request.behavior.daytime === undefined? true : request.behavior.daytime;
        behaviorFromId.requireResponse = request.behavior.requireResponse;
        behaviorFromId.baseline = request.behavior.baseline;
        behaviorFromId.trackAbc = request.behavior.trackAbc;
        behaviorFromId.intensity = request.behavior.intensity;
    }
    
    console.log('Saving student');
    await StudentDal.saveStudent(student);
    console.log('Save complete');
    
    return newBehavior;
}
