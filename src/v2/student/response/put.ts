import { v4 as uuid} from 'uuid';
import { v2, WebUtils, WebUserDetails, WebError } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx<typesV2.StudentResponsePutRequest>(handler, {
    schema: typesV2.StudentResponsePutRequestSchema
});

export async function handler(request: typesV2.StudentResponsePutRequest, userDetails: WebUserDetails) {
    console.log('Getting user data');
    const user = await v2.TeamDal.getTeamMember(userDetails.userId, request.studentId, false);
    if(!user || user.restrictions.behavior !== typesV2.AccessLevel.admin ) {
        throw new WebError('Access Denied');
    }
    let student = await v2.StudentDal.getStudent(request.studentId, userDetails.userId);
    
    let responseFromId: typesV2.StudentResponse | undefined;
    console.log('Checking if behavior is present')
    if (request.response.id){
        responseFromId = student.responses.find(behavior => behavior.id == request.response.id);
        if(!responseFromId){
            throw new WebError('The specified behavior is not found');
        }
    }
    else {
        for(let i in student.behaviors){
            let behavior = student.behaviors[i];
            if(behavior.name.toLowerCase().trim() == request.response.name.toLowerCase().trim()){
                console.log(`The behavior is already present for student ${request.studentId}`);
                throw new WebError('The specified behavior is already present');
            }
        }
    }
    let newReponse = responseFromId;
    if(!responseFromId) {
        console.log('Adding behavior to student');
        newReponse = {
            name: request.response.name,
            isArchived: false,
            isDuration: request.response.isDuration,
            targets: request.response.targets,
            desc: request.response.desc,
            daytime: request.response.daytime === undefined? true : request.response.daytime,
            id: uuid(),
            requireResponse: request.response.requireResponse,
            tags: []
        } as typesV2.StudentResponse;
        student.responses.push(newReponse);
    } else {
        console.log('Updating behavior for student');
        WebUtils.logObjectDetails(request.response.targets);
        responseFromId.name = (request.response.name)? request.response.name : responseFromId.name;
        responseFromId.isArchived = (request.response.isArchived !== undefined)? request.response.isArchived : responseFromId.isArchived;
        responseFromId.isDuration = (request.response.isDuration !== undefined)? request.response.isDuration : responseFromId.isDuration;
        responseFromId.targets = request.response.targets;
        responseFromId.desc = request.response.desc;
        responseFromId.daytime = request.response.daytime === undefined? true : request.response.daytime;
        responseFromId.requireResponse = request.response.requireResponse;
    }
    
    console.log('Saving student');
    await v2.StudentDal.saveStudent(student);
    console.log('Save complete');
    
    return newReponse;
}
