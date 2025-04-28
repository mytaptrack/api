import { AccessLevel, QLReportData, QLReportDataSource, QLReportDetails, QLReportService } from '@mytaptrack/types';
import { MttAppSyncContext } from '@mytaptrack/cdk';
import { StudentReportStorage } from '../../types/reports';
import { AppPiiGlobal, DevicePiiGlobalStorage, LookupDal, Moment, UserDataStorage, UserPrimaryStorage, WebUtils, generateDeviceGlobalKey, getAppGlobalKey, getStudentPrimaryKey, getUserPrimaryKey, moment } from '@mytaptrack/lib';
import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';

const dataDal = new Dal('data');
const primaryDal = new Dal('primary');

interface Params {
    studentId: string;
    startDate: string;
    endDate: string;
    scope: {
        behavior: boolean;
        service: boolean;
    }
}

interface StashData {
    start: number;
    end: number;
}

export const handler = WebUtils.graphQLWrapper(handleEvent);

async function handleEvent(context: MttAppSyncContext<Params, never, never, StashData>) {
    const startDate: Moment = moment(context.arguments.startDate);
    const endDate: Moment = moment(context.arguments.endDate);
    const scope = context.arguments.scope;
    const restrictions = context.stash.permissions.student;
    const license = context.stash.permissions.license;
    
    console.log('Start:', startDate, ', end:', endDate);
    const pk = `S#${context.arguments.studentId}#R`;
    const start = startDate.clone().startOf('week').toDate().getTime() + '#D';
    const end = (endDate.clone().endOf('week').toDate().getTime() + (1000 * 60 * 60 * 24)) + '#D';

    console.log('Query for reports');
    const reports = await dataDal.query<StudentReportStorage>({
        keyExpression: "pk = :pk AND sk BETWEEN :start AND :end",
        attributeNames: {
            "#data": "data"
        },
        attributeValues: {
            ":pk": pk,
            ":start": start,
            ":end": end
        },
        projectionExpression: '#data,services,excludeDays,excludedIntervals,includeDays,schedules'
    });

    const data: QLReportData[] = [];
    const services: QLReportService[] = [];
    const schedules = [].concat(...reports.map(r => {
        if(r.schedules && !Array.isArray(r.schedules)) {
            return Object.keys(r.schedules).map(key => {
                return {
                    date: `${key.slice(0, 4)}-${key.slice(5, 6)}-${key.slice(7, 8)}`,
                    schedule: r.schedules[key]
                }
            });
        }
        return r.schedules;
    }).filter(x => x? true : false));
    const excludeDays = [].concat(...reports.map(r => r.excludeDays).filter(x => x? true : false));
    const includeDays = [].concat(...reports.map(r => r.includeDays).filter(x => x? true : false));
    const excludedIntervals = [].concat(...reports.map(r => r.excludedIntervals).filter(x => x? true : false));
    const shortIds: string[] = [];
    let lastUpdateDate = 0;
    const raters: QLReportDataSource[] = [];

    console.log('Processing reports ', reports?.length);
    reports.forEach(resp => {
        if(scope.service && (restrictions.serviceData == AccessLevel.read || restrictions.serviceData == AccessLevel.admin)) {
            resp.services?.forEach(item => {
                if(item.deleted) {
                    return;
                }
                if(restrictions.services && !restrictions.services.find(x => x == item.service)) {
                    return;
                }
                services.push({
                    dateEpoc: item.dateEpoc,
                    service: item.service,
                    duration: item.duration,
                    reported: item.reported,
                    isManual: item.isManual,
                    notStopped: item.notStopped,
                    source: item.source,
                    modifications: item.modifications,
                    serviceProgress: item.serviceProgress
                })
            });
        }
        if(scope.behavior) {
            resp.data?.forEach(item => {
                if(restrictions.behaviors && !restrictions.behaviors.find(x => x == item.behavior)) {
                    return;
                }
                if(item.abc) {
                    console.log('Adding short keys');
                    if(item.abc.a) shortIds.push(item.abc.a);
                    if(item.abc.c) shortIds.push(item.abc.c);
                }
                data.push({
                    abc: item.abc,
                    intensity: item.intensity,
                    behavior: item.behavior,
                    dateEpoc: item.dateEpoc,
                    duration: item.duration,
                    deleted: item.deleted,
                    isManual: item.isManual,
                    reported: item.reported!,
                    notStopped: item.notStopped,
                    score: item.score,
                    source: {
                        rater: item.source!.rater!,
                        device: item.source!.device
                    }
                });

                if(item.source && !raters.find(x => x.device == item.source.device && x.rater == item.source.rater)) {
                    raters.push(item.source);
                }
            });
        }
    });

    let raterNames: { rater: string, name: string}[];
    if(context.info.selectionSetList.find(x => x == 'raters')) {
        raterNames = await Promise.all(raters.map(async r => {
            if(r.device == 'Web') {
                const user = await primaryDal.get<UserPrimaryStorage>(getUserPrimaryKey(r.rater), '#name', { '#name': 'name' });
                return { rater: r.rater, name: user?.details?.name ?? 'Unknown User' };
            }
            if(r.device == 'App') {
                const app = await primaryDal.get<AppPiiGlobal>(getAppGlobalKey(license, r.rater), 'deviceName');
                return { rater: r.rater, name: app?.deviceName ?? 'Unknown App' };
            }
            if(r.device == 'Track 2.0') {
                const app = await primaryDal.get<DevicePiiGlobalStorage>(generateDeviceGlobalKey(r.rater), '#name', { '#name': 'name' });
                return { rater: r.rater, name: app?.name ?? 'Unknown Track 2.0' };
            }
            return { rater: r.rater, name: 'Unknown Rater' };
        }));
    }

    if(shortIds.length > 0) {
        console.log('Getting short ids', shortIds.length);
        const tags = await LookupDal.getTagsFromShortIds(context.stash.permissions.license, shortIds);
        console.log('Processing short ids', tags.length);
        data.forEach(item => {
            if(item.abc) {
                if(item.abc.a) {
                    item.abc!.a = tags.find(k => k.shortId == item.abc!.a)?.tag ?? item.abc.a;
                }
                if(item.abc.c) {
                    item.abc!.c = tags.find(k => k.shortId == item.abc!.c)?.tag ?? item.abc.c;
                }
            }
        });
    }

    console.log('Constructing result');
    const result = {
        data: data.filter(x => !x.deleted),
        services: services,
        raters: raterNames,
        startMillis: startDate.toDate().getTime(),
        endMillis: endDate.toDate().getTime(),
        schedules: schedules,
        excludeDays: excludeDays,
        includeDays: includeDays,
        excludedIntervals: excludedIntervals,
        lastUpdateDate: lastUpdateDate,
        version: 1
    } as QLReportDetails;

    console.debug('Result: ', result);

    return result;
    // Need to change ReportDetails to support graph ql non-dynamic object type
}
