import { TeamDal, WebUtils, StudentServiceEstimate, StudentPiiStorage, moment, StudentPii, Moment, ServiceWeeklySummary, getStudentPrimaryKey, StudentConfigStorage, StudentServiceEstimateStatsRaw, ServiceStorage } from '@mytaptrack/lib';
import { CalculatedServiceStat, QLGlobalServiceReport, QLGlobalServicesReport, QLServiceReportStudentSummary, ScheduleItemType } from '@mytaptrack/types';
import { MttAppSyncContext } from '@mytaptrack/cdk';
import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';

interface QueryParams {

}

const dataDal = new Dal('data');
const primary = new Dal('primary')

export const handler: any = WebUtils.graphQLWrapper(handleEvent);

export async function handleEvent(event: MttAppSyncContext<QueryParams, never, never, never>): Promise<QLGlobalServicesReport> {
    console.debug('Event', event);
    const username = event.identity.username;
    const params = event.arguments;
    const start = moment().startOf('week').subtract(4, 'weeks');
    const end = moment().startOf('week');

    const userStudentSummary = await TeamDal.getStudentsForUser(username);
    console.log('userStudents', userStudentSummary.length);
    const studentIds = userStudentSummary
        .filter(s => s?.studentId && s.serviceTracking)
        .map(s => s.studentId);
    console.log('filtered students', studentIds.length);
    
    const [studentDetails, piis] = await Promise.all([
        getStudentServiceStats(studentIds),
        primary.batchGet<StudentPiiStorage>(studentIds.map(id => getStudentPrimaryKey(id)), 'studentId, nickname, firstName, lastName, servicesLookup')
    ]);
    console.debug('student details', studentDetails);

    const outOfCompStudents: StudentServiceEstimate[] = [];
    const atRiskStudents: StudentServiceEstimate[] = [];
    const studentsRemaining: StudentServiceEstimate[] = [];
    const services = generateServiceStats(studentDetails, piis, start, end, outOfCompStudents, atRiskStudents, studentsRemaining);

    console.info('Processing lists', outOfCompStudents.length, atRiskStudents.length, studentsRemaining.length);
    const outOfComp = await Promise.all(outOfCompStudents.map(x => buildServiceReportStudentSummary(x, piis)));
    const atRisk = await Promise.all(atRiskStudents.map(x => buildServiceReportStudentSummary(x, piis)));
    const students = await Promise.all(studentsRemaining.map(us => buildServiceReportStudentSummary(us, piis)));

    console.info('Resulting lists', outOfComp.length, atRisk.length, students.length);

    const retval: QLGlobalServicesReport = {
        services,
        outOfComp: outOfComp.filter(x => x? true : false).map(x => x!),
        atRisk: atRisk.filter(x => x? true : false).map(x => x!),
        students: students.filter(x => x? true : false).map(x => x!),
        schedule: []
    };
    WebUtils.logObjectDetails(retval);

    return retval;
}

async function buildServiceReportStudentSummary(student: StudentServiceEstimate, piis: StudentPiiStorage[]): Promise<QLServiceReportStudentSummary | undefined> {
    const pii = piis.find(x => x.studentId == student.studentId);
    if(!pii) {
        console.error('Cloud not get pii for student', student.studentId);
        return;
    }
    return {
        studentId: student.studentId,
        studentName: pii.nickname ?? `${pii.firstName} ${pii.lastName}`,
        services: student.serviceStats.map(stat => {
            const servicePii = pii.servicesLookup.find(x => x.id == stat.id);
            if(!servicePii) {
                return;
            }
            return {
                serviceId: stat.id,
                serviceName: servicePii!.name,
                currentWeek: stat.currentWeek,
                yearToDate: stat.yearToDate,
                lastUpdateDate: stat.lastUpdated,
                percentGoal: stat.currentWeek.goalPercent,
                mitigations: stat.mitigations ?? []
            };
        }).filter(x => x? true : false).map(x => x!)
    };
}

function generateServiceStats(
        studentDetails: StudentServiceEstimate[], 
        piis: StudentPiiStorage[], 
        start: Moment, end: Moment, 
        outOfCompStudents: StudentServiceEstimate[], 
        atRiskStudents: StudentServiceEstimate[], 
        studentsRemaining: StudentServiceEstimate[]): QLGlobalServiceReport[] {
    const serviceStats: {[serviceName: string]: { name: string, id: string, data: {[epoch: number]: number}}} = {};
    const startSec = start.toDate().getTime() / 1000;
    const endSec = end.toDate().getTime() / 1000;
    const weekSec = 60 /*sec*/ * 60 /*min*/ * 24/*hour*/ * 7/*day*/;
    const durationSec = end.diff(start, 'seconds');

    studentDetails.forEach(student => {
        let outOfComp = false;
        let atRisk = false;
        const studentPii = piis.find(x => x.studentId == student.studentId);

        student.serviceStats.forEach(service => {
            if(service.yearToDate.provided < service.yearToDate.projected) {
                outOfComp = true;
            } else if(service.currentWeek.provided < service.currentWeek.projected) {
                atRisk = true;
            }

            const servicePii = studentPii?.servicesLookup.find(x => x.id == service.id);
            if(!servicePii) {
                return;
            }
            let stats = serviceStats[servicePii.name];
            if(!stats) {
                stats = {
                    name: servicePii.name,
                    id: service.id,
                    data: {}
                };
                for(let i = 0; i < durationSec / weekSec; i++) {
                    let onSec = startSec + (i * weekSec);
                    stats.data[onSec] = service.weeklyServiceSummary[onSec]?.minutes ?? 0;
                }
                serviceStats[servicePii.name] = stats;
            }
            Object.keys(stats).forEach(key => {
                const keyInt: number = typeof key == 'string'? Number.parseInt(key) : key;
                const summary: ServiceWeeklySummary = service.weeklyServiceSummary[key];
                if(summary && startSec <= keyInt && keyInt <= endSec) {
                    stats[key] += summary.minutes;
                }
            });
        });

        // Add students to the right list
        if(outOfComp) {
            outOfCompStudents.push(student);
        } else if(atRisk) {
            atRiskStudents.push(student);
        } else {
            studentsRemaining.push(student);
        }
    });

    console.log('Constructing report', start.toISOString(), ' - ', end.toISOString(), ' duration: ', durationSec, ' weekSec:', weekSec, ' times: ', durationSec / weekSec);

    const serviceItems = Object.values(serviceStats);
    console.log('Constructing service report', serviceItems.length);
    if(serviceItems.length == 0) {
        const minutes: number[] = [];
        for(let i = 0; i < durationSec / weekSec; i++) {
            minutes.push(0);
        }
        return [
            {
                serviceId: 'No Service Id',
                serviceName: 'No Services Configured',
                serviceMinutes: minutes
            }
        ];
    }

    const retval: QLGlobalServiceReport[] = serviceItems.map(item => {
        const minutes: number[] = [];
        const data = Object.values(item.data);

        for(let i = 0; i < durationSec / weekSec; i++) {
            let onSec = startSec + (i * weekSec);
            console.log('Adding ', onSec);
            minutes.push(item.data[onSec] ?? 0);
        }

        return {
            serviceId: item.id,
            serviceName: item.name,
            serviceMinutes: minutes
        };
    });

    return retval;
}

async function getStudentServiceStats(studentIds: string[]): Promise<StudentServiceEstimate[]> {
    const results = await dataDal.batchGet<StudentConfigStorage>(
        studentIds.map(x => getStudentPrimaryKey(x)),
        'studentId,services,absences');

    const now = moment();

    return results.map(student => {
        if(!student.absences) student.absences = [];

        return {
            studentId: student.studentId,
            serviceStats: student.services? student.services.map(s => {
                const projections = updateProjection(now, s, student);
                const weeklyServiceSummary: {[key: number]: ServiceWeeklySummary} = s.weeklyServiceSummary;
                const reportKeys = Object.keys(s.weeklyServiceSummary);
                console.log('Projections', projections);
                return {
                    id: s.id,
                    currentWeek: projections.currentWeek,
                    yearToDate: projections.yearToDate,
                    percentGoal: reportKeys.length > 0? s.weeklyServiceSummary[reportKeys[reportKeys.length - 1]]?.avgPercent : 0,
                    mitigations: s.detailedTargets.filter(t => t.type == ScheduleItemType.Makeup && t.date > now.getDate().getTime()),
                    startDate: s.startDate,
                    weeklyServiceSummary
                } as StudentServiceEstimateStatsRaw;
            }) : []
        } as StudentServiceEstimate;
    });
}

function updateProjection(now: moment.Moment, service: ServiceStorage, student: StudentConfigStorage): { yearToDate: CalculatedServiceStat, currentWeek: CalculatedServiceStat } {
    service.excluded = service.excluded ?? 0;
    const serviceStart = moment(service.startDate);
    const beginningOfWeek = now.clone().startOf('week');
    
    const currentWeek = calculateIntervalProjection(beginningOfWeek, now, service, student, false);

    const yearToDate = calculateIntervalProjection(
        serviceStart,
        now.clone().subtract(1, 'week').endOf('week'), 
        service,
        student,
        true);

    return {
        yearToDate,
        currentWeek
    };
}

function calculateIntervalProjection(startDate: moment.Moment, endDate: moment.Moment, service: ServiceStorage, student: StudentConfigStorage, projectCurrentDay: boolean): CalculatedServiceStat {
    const beginningMs = startDate.toDate().getTime();
    const currentMs = endDate.toDate().getTime();
    const currentSec = currentMs / 1000;
    const beginningSec = beginningMs / 1000;

    console.log(JSON.stringify(service));
    const serviceWeeklyStats = service.weeklyServiceSummary;
    const providedArray = Object.keys(serviceWeeklyStats).filter(key => {
        let date = key as any as number;
        if(typeof key == 'string') {
            date = Number.parseInt(key);
        }
        return beginningSec <= date && date < currentSec
    }).map(key => serviceWeeklyStats[key] as ServiceWeeklySummary);
    const lastAvgPercent = providedArray.length == 0? 0 : providedArray[0].avgPercent;

    const providedMinutes = providedArray.length == 0? 0 : providedArray
        .map(item => item.minutes)
        .reduce((prev, next) => prev + next);

    if(service.detailedTargets) {
        const passedDates = service.detailedTargets.filter(scheduledEvent => scheduledEvent.type == 'Scheduled' && beginningMs <= scheduledEvent.date && scheduledEvent.date <= currentMs);
        const removed = service.detailedTargets.filter(scheduledEvent => scheduledEvent.type == 'Scheduled' && student.absences.find(a => a.start <= scheduledEvent.date && scheduledEvent.date <= a.end));
        const fullProjection = passedDates.length == 0? 0 : passedDates.map(t => t.target).reduce((prev, next) => prev + next);
        const fullRemoved = removed.length == 0? 0 : removed.map(t => t.target).reduce((prev, next) => prev + next);
        return {
            provided: providedMinutes,
            projected: fullProjection - fullRemoved,
            removed: fullRemoved,
            goalPercent: lastAvgPercent
        };
    }

    const distanceFromStart = currentMs - beginningMs;
    const fullDuration = service.endDate - service.startDate;
    const singleDayDuration = fullDuration / (24*60*60*1000);
    const singleDayTarget = (singleDayDuration / fullDuration) * service.target;

    if(!service.durationRounding) {
        service.durationRounding = 1;
    }
    const projection = Math.round(((distanceFromStart / fullDuration) * service.target) / service.durationRounding) * service.durationRounding;
    const removed = Math.round(student.absences.length * singleDayTarget);

    return {
        provided: providedMinutes,
        projected: projection - removed,
        removed,
        goalPercent: lastAvgPercent
    };
}