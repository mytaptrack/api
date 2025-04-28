import {
    EventDal, IoTClickType, MttEventType, ProcessButtonRequest, WebError, 
    WebUtils, getStudentPrimaryKey, moment 
} from '@mytaptrack/lib';
import {
    QLReportData, QLReportDataInput, QLReportService
} from '@mytaptrack/types';
import { MttAppSyncContext } from '@mytaptrack/cdk';

import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';
import { StudentConfigStorage } from '@mytaptrack/lib';

interface AppSyncParams {
  studentId: string;
  data: QLReportDataInput;
}

const dataDal = new Dal('data');

export const handler = WebUtils.graphQLWrapper(handleEvent);

export async function handleEvent(context: MttAppSyncContext<AppSyncParams, never, never, {}>): Promise<QLReportData | QLReportService> {
    console.log('Recovery Data', context.arguments);
    
    const data = context.arguments.data;
    const studentId = context.arguments.studentId;
    if(!data.source) {
        data.source = {
            device: 'website',
            rater: context.identity.username
        }
    }

    if (data.behavior || data.service) {
        const student = await dataDal.get<StudentConfigStorage>(getStudentPrimaryKey(studentId), 'behaviors, responses, services');

        console.debug('student', student);
        const studentBehavior = student.behaviors?.find(x => x.id == data.behavior) ??
            student.responses?.find(x => x.id == data.behavior) ??
            student.services?.find(x => x.id == data.service);

        if(!studentBehavior) {
            throw new WebError('Could not find behavior');
        }

        let notStopped = data.duration != undefined;
        
        console.log('Constructing message');
        const message = {
            studentId,
            behaviorId: data.behavior,
            dateEpoc: data.dateEpoc? moment(data.dateEpoc).toDate().getTime() : moment().toDate().getTime(),
            abc: data.abc,
            intensity: data.intensity,
            clickType: data.isManual? IoTClickType.manual : IoTClickType.clickCount,
            remainingLife: 1500,
            notStopped,
            duration: data.duration,
            isDuration: studentBehavior.isDuration,
            source: data.source ?? {
                device: 'website',
                rater: context.identity.username
            },
            remove: data.deleted? true : false,
            redoDurations: data.redoDurations
        } as ProcessButtonRequest;

        console.log('sending message to sqs');
        await EventDal.sendEvents('website', [{
            type: MttEventType.trackEvent,
            data: message
        }]);
    } else {
        throw new WebError('Cannot determine the type of item tracked', 400);
    }

    return context.arguments.data as any;
}
