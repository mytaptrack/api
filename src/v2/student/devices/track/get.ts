import { AppStoredObject, v2, WebError, WebUserDetails, WebUtils} from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';
import { Schema } from 'jsonschema';

const ParameterSchema: Schema = {
    type: 'object',
    properties: {
        studentId: { type: 'string', required: true },
        dsn: { type: 'string', required: true }
    }
};

export const handleEvent = WebUtils.apiWrapperEx(handler, { processBody: 'Parameters', schema: ParameterSchema });

export async function handler (request: { studentId: string, dsn: string }, userDetails: WebUserDetails): Promise<typesV2.IoTDevice> {
    console.log('Getting student id');
    const studentId = request.studentId;

    console.log('Checking if user is on students team');
    const teamMember = await v2.TeamDal.getTeamMember(userDetails.userId, studentId);
    if(teamMember.restrictions.devices == typesV2.AccessLevel.none) {
        throw new Error('Access Denied');
    }
    console.log('User is on student team');
    
    const device = await v2.DeviceDal.get(request.dsn, request.studentId);
    if(!device) {
        throw new WebError('Device not found');
    }
    if(!device.studentId) {
        console.log('Device is new, returning empty device');
    } else {
        const studentConfig = await v2.StudentDal.getStudentConfig(studentId);
        if (device.multiStudent && studentConfig.license == device.license) {
            console.log('Multi-student and license validated');
            device.validated = true;
        } else if(device?.studentId && !(device.studentId == request.studentId || device.commands.find(x => x.studentId == request.studentId))) {
            throw new Error('Access Denied');
        }
    }

    return device;
};
