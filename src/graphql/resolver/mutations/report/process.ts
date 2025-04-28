import { 
    WebUtils, generateDataKey, moment, Moment, StudentConfigStorage, getStudentPrimaryKey, 
    ProcessServiceRequest, ProcessButtonRequest, EventDal, MttEventType, ProcessButtonRequestExtended, UserStudentTeam, LambdaAppsyncQueryClient 
} from '@mytaptrack/lib';
import {
    AccessLevel,
    QLReportData, QLReportService
} from '@mytaptrack/types';
import { Dal, DalKey, MttIndexes } from '@mytaptrack/lib/dist/v2/dals/dal';
import { ReportDataStorage, ReportServiceDataStorage, StudentReportStorage } from '../../types/reports';
import { SQSEvent } from 'aws-lambda';

const appsync = new LambdaAppsyncQueryClient(process.env.appsyncUrl);

interface AppSyncParams {
    studentId: string;
    data: QLReportData | QLReportService;
}

const dataDal = new Dal('data');
const primaryDal = new Dal('primary');

interface ReportPackage {
    report: StudentReportStorage;
    student: StudentConfigStorage;
}

export const handler = WebUtils.lambdaWrapper(handleEvent);

export async function handleEvent(event: SQSEvent) {
    console.log('Handling event', event);
    let reportPackage: ReportPackage | undefined;
    for(let i = 0; i < event.Records.length; i++) {
        const r = event.Records[i];
        const input: ProcessServiceRequest | ProcessButtonRequest = JSON.parse(r.body);
        if(reportPackage && (reportPackage.report.studentId != input.studentId || input.dateEpoc < reportPackage.report.startMillis || reportPackage.report.endMillis < input.dateEpoc)) {
            reportPackage = undefined;
        }
        if(!input.dateEpoc) {
            console.log('No date error:', input);
        } else {
            reportPackage = await processData(input, input.studentId, reportPackage);
        }
    }
}

async function processData(dataInput: ProcessServiceRequest | ProcessButtonRequest, studentId: string, previousReport?: ReportPackage): Promise<ReportPackage | undefined> {
    const data = dataInput as ProcessButtonRequest;
    const service = dataInput as ProcessServiceRequest;

    const trackedDate = moment(data.dateEpoc);
    const isWeekEndOverlap = (data.timezone? trackedDate.tz(data.timezone) : trackedDate).weekday() == 6;
    const weekStart: Moment = moment(data.dateEpoc)
        .subtract(isWeekEndOverlap? 1 : 0, 'day')
        .startOf('week');
    
    const weekStartEpoc = weekStart.toDate().getTime();
    console.info('Getting data from dynamo', studentId, weekStartEpoc);

    const reportKey = generateDataKey(studentId, weekStartEpoc);
    let [report, student] = await Promise.all([
        previousReport? Promise.resolve(previousReport.report) : dataDal.get<StudentReportStorage>(reportKey),
        dataDal.get<StudentConfigStorage>(getStudentPrimaryKey(studentId))
    ]);

    if(!student) {
        console.error('Cannot retrieve student', dataInput);
        WebUtils.setError(new Error('Could not find student'));
        return previousReport;
    }
    if(!student.license) {
        console.error('Student does not have a license', dataInput);
        WebUtils.setError(new Error('Student does not have a license'));
        return previousReport;
    }

    const behavior = student?.behaviors?.find(x => x.id == data.behaviorId) ??
        student?.responses?.find(x => x.id == data.behaviorId);
    if(service.serviceId || behavior?.isDuration) {
        console.info('Evaluating duration info');
        if(data.duration != undefined) {
            delete data.notStopped;
        } else {
            data.notStopped = true;
        }
    }

    const reportData: ReportDataStorage = data.behaviorId? {
        dateEpoc: data.dateEpoc,
        behavior: data.behaviorId,
        duration: behavior?.isDuration? data.duration : undefined,
        isManual: data.isManual,
        notStopped: data.notStopped,
        source: {
            device: data.source?.device ?? '',
            rater: data.source?.rater
        },
        deleted: data.remove? {
            by: data.source?.rater,
            date: moment().toISOString()
        } : undefined,
        abc: data.abc,
        intensity: data.intensity
    } : undefined;
    
    // set east coast day roll over
    const dayStartEpoc = moment(data.dateEpoc).startOf('day').add(5, 'hours').toDate().getTime();
    const dayEndEpoc = dayStartEpoc + ( 24 * 60 * 60 * 1000);

    let lastEvent: ReportDataStorage;
    if(report) {
        if(!report.data) {
            report.data = [];
        }
        report.data.sort((a, b) => ((a.dateEpoc - b.dateEpoc) * 10000000000) + a.source?.rater.localeCompare(b.source?.rater));
        const reportDedupeData: ReportDataStorage[] = [];
        for(let i = 0; i < report.data.length; i++) {
            const be = report.data[i];
            if(reportDedupeData.find(x => x.dateEpoc == be.dateEpoc && x.source?.rater == be.source?.rater)) {
                console.info('Removing duplicate entry');
            } else {
                reportDedupeData.push(be);
            }
        }
        if(reportDedupeData.length != report.data.length) {
            console.info('Setting dedupe data')
            report.data = reportDedupeData;
        }
    }

    console.debug('Processing report', report? true : false, student? true : false);
    if(behavior && report) {
        if(behavior.isDuration && data.redoDurations) {
            console.info('Rebuilding durations', report.data.length);
            // Duration resorting
            const behaviorEvents = report.data.filter(x => x.behavior == behavior.id);
            
            console.info('Building legacy events', behaviorEvents.length);
            behaviorEvents.forEach(x => {
                if(x.duration != undefined) {
                    behaviorEvents.push({
                        ...x,
                        dateEpoc: x.dateEpoc + x.duration
                    });
                }
            });

            console.log('Legacy events built', behaviorEvents.length);

            const existingIndex = behaviorEvents.findIndex(x => x.dateEpoc == reportData.dateEpoc);
            if(existingIndex >= 0) {
                console.info('Replacing existing event', existingIndex);
                behaviorEvents[existingIndex] = reportData;
            } else {
                console.info('Adding new event');
                behaviorEvents.push(reportData);
            }
            console.debug('behaviorEvents', behaviorEvents);

            console.info('Sorting events by date');
            behaviorEvents.sort((a, b) => a.dateEpoc - b.dateEpoc);
            lastEvent = undefined;
            for(let i = 0; i < behaviorEvents.length; i++) {
                const event = behaviorEvents[i];
                console.debug('event', i, event);
                if(event.deleted) {
                    console.info('Skipping deleted event');
                    continue;
                }

                if(lastEvent) {
                    console.info('Completing duration for index', i);
                    lastEvent.duration = event.dateEpoc - lastEvent.dateEpoc;
                    lastEvent.notStopped = false;
                    behaviorEvents.splice(i, 1);
                    i--;
                    lastEvent = null;
                } else {
                    console.info('Setting event as start duration', i);
                    lastEvent = event;
                    delete lastEvent.duration;
                    lastEvent.notStopped = true;
                }
            }

            console.info('Rebuilding data');
            report.data = [
                ...report.data.filter(x => x.behavior != behavior.id),
                ...behaviorEvents
            ];
            console.info('sorting data', report.data.length);
            report.data.sort((a, b) => a.dateEpoc - b.dateEpoc);
        } else if(behavior.isDuration) {
            console.info('Processing current model duration start', dayStartEpoc, ', end', dayEndEpoc);
            const reportDatas = [...report.data].sort((a, b) => b.dateEpoc - a.dateEpoc);
            const lastData = reportDatas.find(d => 
                dayStartEpoc <= d.dateEpoc && d.dateEpoc <= dayEndEpoc &&
                d.behavior == data.behaviorId && 
                d.dateEpoc == data.dateEpoc);

            console.info('Last data found', lastData? true : false);
            if(lastData) {
                console.log('Existing data found');
                console.debug('Existing', lastData.dateEpoc, ' New', data.dateEpoc);
                if(lastData.dateEpoc == data.dateEpoc) {
                    if(data.remove) {
                        console.info('Removing data');
                        lastData.deleted = {
                            by: data.source.rater,
                            date: moment().toISOString()
                        }
                    } else {
                        console.info('Setting data values')
                        lastData.notStopped = data.notStopped;
                        lastData.duration = data.duration;
                        if(data.remove && !lastData.deleted) {
                            lastData.deleted = {
                                by: data.source.rater,
                                date: moment().toISOString()
                            };
                        }
                    }
                } else if(lastData.notStopped) {
                    console.info('Setting duration and removing not stopped');
                    lastData.duration = data.dateEpoc - lastData.dateEpoc;
                    lastData.abc = data.abc;
                    lastData.intensity = data.intensity;
                    if(data.remove && !lastData.deleted) {
                        lastData.deleted = {
                            by: data.source.rater,
                            date: moment().toISOString()
                        }
                    }
                    delete lastData.notStopped;
                } else {
                    console.info('Adding data as no existing found');
                    report.data.push({
                        ...reportData,
                        notStopped: true,
                        duration: undefined
                    });
                }
            } else {
                console.info('Adding data as new measurement to report');
                report.data.push({
                    ...reportData,
                    notStopped: true,
                    duration: undefined
                });
            }
        } else {
            console.info('Processing event data');
            const lastData = report.data.find(d => {
                if(d.behavior == data.behaviorId && d.dateEpoc == data.dateEpoc) {
                    if(d.source.rater == data.source.rater) {
                        return true;
                    }
                }
            });
            if(lastData) {
                console.log('Existing event data found');
                if(data.remove && !lastData.deleted) {
                    lastData.deleted = {
                        by: data.source.rater,
                        date: moment().toISOString()
                    };
                }
                if(data.abc) {
                    lastData.abc = data.abc;
                }
                if(data.intensity) {
                    lastData.intensity = data.intensity;
                }
            } else {
                report.data.push({
                    behavior: data.behaviorId,
                    dateEpoc: data.dateEpoc,
                    abc: data.abc,
                    intensity: data.intensity,
                    source: data.source
                });
            }
        }

        await dataDal.update({
            key: { pk: report.pk, sk: report.sk },
            updateExpression: 'SET #data = :data',
            attributeNames: {
                '#data': 'data'
            },
            attributeValues: {
                ':data': report.data
            }
        });

        console.info('Returning report data');
        if(reportData) {
            console.info('Sending event to event bus');
            await EventDal.sendEvents('report-processing', [{
                type: MttEventType.reportProcessEvent,
                data: {
                    ...reportData,
                    studentId: data.studentId,
                    behaviorId: data.behaviorId,
                    attributes: {},
                    remainingLife: data.remainingLife,
                    serialNumber: data.serialNumber,
                    clickType: data.clickType,
                    remove: data.remove,
                    isDuration: data.isDuration
                } as ProcessButtonRequestExtended
            }]);
        }


        await notifyTeam(studentId, reportData);
        return {
            report,
            student
        };
    }

    const reportService: ReportServiceDataStorage = service.serviceId? {
        dateEpoc: service.dateEpoc,
        service: service.serviceId,
        duration: service.duration,
        isManual: service.isManual,
        notStopped: service.notStopped,
        source: {
            device: service.source.device ?? '',
            rater: data.source.rater ?? ''
        },
        deleted: service.remove? {
            by: service.deviceId,
            date: moment().toISOString()
        } : undefined,
        modifications: service.modifications,
        serviceProgress: service.progress
    } : undefined;
    if(service.serviceId && report) {
        console.info('Processing service');
        const lastData = report.services?.find(d => d.service == service.serviceId && d.dateEpoc <= service.dateEpoc && (d.dateEpoc == service.dateEpoc || d.source.rater == service.source.rater));
        if(lastData) {
            console.info('Previous data found');
            if(lastData.dateEpoc == service.dateEpoc) {
                console.info('Setting service information as event is same event');
                lastData.notStopped = service.notStopped;
                lastData.duration = service.duration;
                lastData.modifications = service.modifications;
                lastData.serviceProgress = service.progress;
            } else if(lastData.notStopped) {
                console.info('Setting not stopped data');
                lastData.duration = data.dateEpoc - lastData.dateEpoc;
                lastData.serviceProgress = service.progress;
                lastData.modifications = service.modifications;
                if(data.remove && !lastData.deleted) {
                    lastData.deleted = {
                        by: data.source.rater,
                        date: moment().toISOString()
                    }
                }
                delete lastData.notStopped;
            } else {
                console.info('Adding new data to report');
                report.services.push({
                    ...reportService,
                    notStopped: reportService.notStopped? true : false,
                    duration: reportService.duration
                });
            }
        } else {
            console.info('Adding new data to report');
            report.services.push({
                ...reportService,
                notStopped: true,
                duration: undefined
            });
        }

        await dataDal.update({
            key: { pk: report.pk, sk: report.sk },
            updateExpression: 'SET #services = :services',
            attributeNames: {
                '#services': 'services'
            },
            attributeValues: {
                ':services': report.services
            }
        });
    }

    if(!report) {
        console.info('Creating new report');
        const newReport: StudentReportStorage = {
            ...reportKey,
            pksk: `${reportKey.pk}#${reportKey.sk}`,
            license: student.license,
            data: data.behaviorId? [reportData] : [],
            services: service.serviceId? [reportService] : [],
            startMillis: weekStartEpoc,
            endMillis: weekStart.endOf('week').toDate().getTime(),
            studentId: studentId,
            lpk: student.license,
            lsk: `${studentId}#${weekStartEpoc}`,
            tsk: `R#${weekStartEpoc}`,
            schedules: [],
            excludeDays: [],
            includeDays: [],
            excludedIntervals: [],
            version: 2
        };
        await dataDal.put<StudentReportStorage>(newReport);
        report = newReport;
    }

    if(reportService) {
        // EventDal.sendEvents('report-processing', [{
        //     type: MttEventType.reportProcessEvent,
        //     data: reportService
        // }]);
    }

    await notifyTeam(studentId, reportData);

    return {
        report,
        student
    }
}

async function notifyTeam(studentId: string, reportData: QLReportData) {
    console.info('Notifying team');
    const team = await dataDal.query<UserStudentTeam>({
        keyExpression: 'studentId = :studentId and begins_with(tsk, :tsk)',
        indexName: MttIndexes.student,
        attributeValues: {
            ':studentId': studentId,
            ':tsk': 'T#'
        }
    });

    console.info('Processing team notifications', team.length);
    await Promise.all(team.map(async t => {
        if(!(t.restrictions.data == AccessLevel.admin || t.restrictions.data == AccessLevel.read)) {
            return;
        }
        await appsync.query(`
            mutation studentDataChange($input: ReportEventDataInput!) {
                studentDataChange(input: $input) {
                    userId
                    studentId
                    behavior
                    dateEpoc
                    deleted {
                        by
                        date
                    }
                    duration
                    isManual
                    modifications
                    notStopped
                    progress {
                        measurements {
                        name
                        value
                        }
                        progress
                    }
                    redoDurations
                    reported
                    score
                    service
                    serviceProgress {
                        measurements {
                        name
                        value
                        }
                        progress
                    }
                    source {
                        rater
                        device
                    }
                }
            }`,
        { 
            input: {
                ...reportData,
                studentId: t.studentId,
                userId: t.userId
            }
        }, 'studentDataChange')
    }));
}

async function processBehavior(reportKey: DalKey, data: ProcessButtonRequest, report: StudentReportStorage) {
    if(!report.data) {
        report.data = [];
    }
    console.info('Handling behavior data processing');
    const reportData = report.data.find(d => d.behavior == data.behaviorId && d.dateEpoc == data.dateEpoc && d.source.rater == data.source.rater);

    if(reportData) {
        console.log('Data already exists');
        if(data.abc) {
            console.info('Setting abc data');
            reportData.abc = data.abc;
        }
        if(data.intensity) {
            console.info('Setting intensity data');
            reportData.intensity = data.intensity;
        }
        if(data.remove) {
            console.warn('Setting delete data');
            reportData.deleted = {
                by: data.source.rater,
                date: moment().toISOString()
            }
        }
        if(data.duration != undefined) {
            console.info('Setting duration data');
            reportData.duration = data.duration;
            delete reportData.notStopped;
        }
        if(data.isManual != undefined) {
            console.info('Setting isManual data');
            reportData.isManual = data.isManual;
        }
        if(data.notStopped != undefined) {
            console.info('Setting notStopped data');
            reportData.notStopped = data.notStopped;
        }
    } else {
        console.info('Adding new data');
        report.data.push({
            dateEpoc: data.dateEpoc,
            behavior: data.behaviorId,
            duration: data.duration,
            isManual: data.isManual? true : undefined,
            notStopped: data.notStopped,
            source: data.source!,
            deleted: data.remove? {
                by: data.source.rater,
                date: moment().toISOString()
            } : undefined,
            abc: data.abc,
            intensity: data.intensity
        });
    }
    await dataDal.update({
        key: reportKey,
        updateExpression: 'SET #data = :data',
        attributeNames: {
            '#data': 'data'
        },
        attributeValues: {
            ':data': report.data
        }
    });
}

async function processService(reportKey: DalKey, service: ProcessServiceRequest, report: StudentReportStorage) {
    if(!report.services) {
        report.services = [];
    }
    console.log('Processing service data');
    const reportData = report.services.find(d => d.service == service.serviceId && d.dateEpoc == service.dateEpoc && d.source.rater == service.source.rater);

    if(reportData) {
        console.info('Processing update to existing data');
        if(service.modifications) {
            console.info('Setting notStopped data');
            reportData.modifications = service.modifications;
        }
        if(service.remove) {
            console.info('Setting deleted data');
            reportData.deleted = {
                by: service.deviceId,
                date: moment().toDate().toISOString()
            }
        }
        if(service.duration != undefined) {
            console.info('Setting duration data');
            reportData.duration = service.duration;
            delete reportData.notStopped;
        } else {
            console.info('Removing duration data');
            delete reportData.duration;
            reportData.notStopped = true;
        }
        if(service.isManual != undefined) {
            console.info('Setting isManual data');
            reportData.isManual = service.isManual;
        }
        if(service.progress != undefined) {
            console.info('Setting progress data');
            reportData.serviceProgress = service.progress;
        }
    } else {
        console.info('Adding new data');
        report.services.push({
            dateEpoc: service.dateEpoc,
            service: service.serviceId,
            duration: service.duration,
            reported: true,
            isManual: service.isManual,
            notStopped: service.notStopped,
            source: service.source,
            deleted: service.remove? {
                by: service.deviceId,
                date: moment().toISOString()
            } : undefined,
            modifications: service.modifications,
            serviceProgress: service.progress
        });
    }
    await dataDal.update({
        key: reportKey,
        updateExpression: 'SET #services = :services',
        attributeNames: {
            '#services': 'services'
        },
        attributeValues: {
            ':services': report.services
        }
    });

    const update = {
        key: { pk: `S#${service.studentId}`, sk: 'P'},
        updateExpression: 'SET #lastTracked = :lastTracked',
        attributeNames: {
            '#lastTracked': 'lastTracked'
        },
        attributeValues: {
            ':lastTracked': moment(service.dateEpoc).toISOString()
        }
    };
    await Promise.all([
        dataDal.update(update),
        primaryDal.update(update)
    ]);
}
