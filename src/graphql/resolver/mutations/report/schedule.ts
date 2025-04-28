import {
    EventDal, IoTClickType, MttEventType, ProcessButtonRequest, WebError, 
    WebUtils, getStudentPrimaryKey, moment 
} from '@mytaptrack/lib';
import {
    QLReportData, QLReportDataInput, QLReportDetailsSchedule, QLReportService
} from '@mytaptrack/types';
import { MttAppSyncContext } from '@mytaptrack/cdk';

import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';
import { StudentConfigStorage } from '@mytaptrack/lib';
import { StudentReportStorage } from '../../types/reports';

interface AppSyncParams {
  studentId: string;
  data: QLReportDetailsSchedule;
}

const dataDal = new Dal('data');

export const handler = WebUtils.graphQLWrapper(handleEvent);

export async function handleEvent(context: MttAppSyncContext<AppSyncParams, never, never, {}>): Promise<QLReportDetailsSchedule> {
    console.log('Recovery Data', context.arguments);
    
    const data = context.arguments.data;
    const studentId = context.arguments.studentId;
    
    const date = moment(data.date, 'yyyy-MM-DD');
    if(!date.isValid()) {
        throw new WebError('Invalid date');
    }

    const weekStart = date.clone().startOf('week');
    const pk = `S#${context.arguments.studentId}#R`;
    const sk = weekStart.clone().startOf('week').toDate().getTime() + '#D';

    const existing = await dataDal.get<StudentReportStorage>({pk, sk}, 'schedules');
    if(existing) {
        if(!existing.schedules) {
            existing.schedules = [];
        } else if(!Array.isArray(existing.schedules)) {
            existing.schedules = Object.keys(existing.schedules).map(k => {
                let date = moment(k, 'yyyyMMDD');
                if(!date.isValid()) {
                    date = moment(k, 'yyyy-MM-DD');
                }

                return { date: date.format('yyyyMMDD'), schedule: (existing.schedules as any)[k] } as QLReportDetailsSchedule
            });
        }

        if(data.schedule) {
            const existingSchedule = existing.schedules.find(x => x.date == data.date);
            if(existingSchedule) {
                existingSchedule.schedule = data.schedule;
            } else {
                existing.schedules.push(data);
            }
        } else {
            const existingScheduleIndex = existing.schedules.findIndex(x => x.date == data.date);
            if(existingScheduleIndex >= 0) {
                existing.schedules.splice(existingScheduleIndex, 1);
            }
        }
        await dataDal.update({
            key: { pk, sk },
            updateExpression: 'SET #schedules = :schedules',
            attributeNames: {
                '#schedules': 'schedules'
            },
            attributeValues: {
                ':schedules': existing.schedules
            }
        });
    } else {
        if(!data.schedule) {
            return data;
        }
        const student = await dataDal.get<StudentConfigStorage>(getStudentPrimaryKey(studentId), 'license');
        const weekStartEpoc = weekStart.toDate().getTime();
        await dataDal.put<StudentReportStorage>({
            pk,
            sk,
            pksk: `${pk}#${sk}`,
            license: student.license,
            data: [],
            services: [],
            startMillis: weekStartEpoc,
            endMillis: weekStart.clone().endOf('week').toDate().getTime(),
            studentId: studentId,
            lpk: student.license,
            lsk: `${studentId}#${weekStartEpoc}`,
            tsk: `R#${weekStartEpoc}`,
            schedules: [data],
            excludeDays: [],
            includeDays: [],
            excludedIntervals: [],
            version: 2
        });
    }
    
    return data;
}
