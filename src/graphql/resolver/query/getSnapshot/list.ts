import { UserSummaryRestrictions, QLSnapshotReport, QLSnapshotReports, QLSnapshotReportsKey, AccessLevel, StudentSummaryReportBehavior } from '@mytaptrack/types';
import { MttAppSyncContext } from '@mytaptrack/cdk';
import { Moment, StudentDal, WebUtils, moment } from '@mytaptrack/lib';
import { S3Client, GetObjectCommand, ListObjectsV2Command, _Object } from '@aws-sdk/client-s3';
import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';
import { ReportDataStorage, StudentReportStorage } from '../../types/reports';

const s3Client = new S3Client({});
const dataDal = new Dal('data');

interface Params {
    studentId: string;
    timezone: string;
}


export function getSnapshotKey(studentId: string, reportType: string, date: Moment) {
    const startOfWeek = date.clone().startOf('week');
    return `student/${studentId}/reports/${reportType}/${startOfWeek.format('yyyy')}/${startOfWeek.format('MM-DD')}.json`;
}
export function getSnapshotSavedKey(studentId: string, reportType: string, date: Moment) {
    const startOfWeek = date.clone().startOf('week');
    return `student/${studentId}/reports-saved/${reportType}/${startOfWeek.format('yyyy')}/${startOfWeek.format('MM-DD')}.json`;
}

export const handler = WebUtils.graphQLWrapper(handleEvent);

async function handleEvent(context: MttAppSyncContext<Params, never, never, {}>): Promise<QLSnapshotReports> {
    const studentId = context.arguments.studentId;
    const prefixLength = `student/${studentId}/reports/`.length;
    
    console.log('Listing objects');
    const s3Results: string[] = [];
    {
        const Prefix = `student/${studentId}/reports/`;
        const listResults = await s3Client.send(new ListObjectsV2Command({
            Bucket: process.env.dataBucket,
            Prefix
        }));
        if(listResults?.Contents) {
            s3Results.push(...listResults!.Contents.map(x => x.Key));
        }
    }
    console.info('Saved keys', s3Results.length);

    if(context.stash.permissions.student.reports == AccessLevel.admin) {
        const Prefix = `student/${studentId}/reports-saved/`;
        const listResults = await s3Client.send(new ListObjectsV2Command({
            Bucket: process.env.dataBucket,
            Prefix
        }));
        if(listResults?.Contents) {
            s3Results.push(...listResults!.Contents.map(x => x.Key.replace('reports-saved', 'reports')));
        }
    }

    console.log('Sorting and mapping objects', s3Results.length);
    const dates = s3Results
    .sort().reverse()
    .filter(x => x? true : false)
    .map(x => {
        const key = x!;
        const dotIndex = key.indexOf('.');
        const [ reportType, year, monthDay ] = key.slice(prefixLength, dotIndex).split('/');
        return {
            date: monthDay.replace('-', '/') + '/' + year,
            type: reportType
        } as QLSnapshotReportsKey;
    });

    console.debug('Report dates', dates);
    
    const latest = dates[0];
    let lastReport: QLSnapshotReport | undefined = undefined;
    if(latest) {
        console.info('Getting report', JSON.stringify(latest));
        lastReport = await getSnapshot(studentId, moment(latest.date, 'MM/DD/yyyy'), context.arguments.timezone, latest.type, context.stash.permissions.student)
    }

    console.log('Returning dates');
    return {
        reports: dates,
        latest: lastReport
    };
}

export async function getSnapshot(studentId: string, date: Moment, timezone: string, reportType: 'Weekly' | 'Range', restrictions: UserSummaryRestrictions): Promise<QLSnapshotReport> {
    const strDate = date.format('yyyy-MM-DD');
    let requestDate = moment.tz(strDate, timezone);
    let report: QLSnapshotReport;
    let published = true;
    try {
        let body: string;
        if(restrictions.reports == AccessLevel.admin) {
            try {
                console.info('Getting snapshot saved data');
                const Key = getSnapshotSavedKey(studentId, reportType, requestDate);
                console.info('Getting saved data', process.env.dataBucket, Key);
                const s3Response = await s3Client.send(new GetObjectCommand({
                    Bucket: process.env.dataBucket,
                    Key
                }));
                body = await s3Response.Body!.transformToString();
                published = false;
            } catch (err) {
                console.log(err);
            }
        }

        if(!body) {
            console.info('Getting published snapshot')
            const Key = getSnapshotKey(studentId, reportType, requestDate);

            console.log('Retrieving S3 data', process.env.dataBucket, Key);
            try {
                const s3Response = await s3Client.send(new GetObjectCommand({
                    Bucket: process.env.dataBucket,
                    Key
                }));
                body = await s3Response.Body!.transformToString();
            } catch (err) {
                console.log(err);
                if(err.Code != 'NoSuchKey') {
                    throw err;
                }
                body = JSON.stringify({
                    studentId,
                    lastModified: {
                        userId: '',
                        date: ''
                    },
                    message: '',
                    date: date.format('yyyy-MM-DD'),
                    type: 'Weekly',
                    behaviors: [],
                    legend: [],
                    published: false
                } as QLSnapshotReport);
            }
        }
        console.debug(body);
        report = JSON.parse(body);
    } catch (err) {
        if(err.Code !== 'AccessDenied') {
            throw err;
        }
        published = false;
        report = {
            date: date.format('yyyy-mm-dd'),
            studentId,
            message: '',
            lastModified: {
                userId: '',
                date: moment().format('MM/DD/yyyy')
            },
            type: reportType,
            behaviors: [],
            legend: [],
            published: false
        };
    }

    if(report.studentId !== studentId) {
        console.log('Student id does not match', studentId, report.studentId);
        throw new Error('Access Denied');
    }

    const prevDate = requestDate.clone().add(-1, 'day');
    const dateStart = requestDate.clone().startOf('week').subtract(1, 'week').subtract(1, 'day');
    const curWeek = requestDate.clone().startOf('week');
    const curWeekEpoc = curWeek.toDate().getTime();
    const dateEnd = requestDate.clone().endOf('week');
    const [studentPii, studentConfig, trackedReports] = await Promise.all([
        StudentDal.getStudentFullPii(studentId),
        StudentDal.getStudentConfig(studentId),
        dataDal.query<StudentReportStorage>({
            keyExpression: 'pk = :pk and sk between :skStart and :skEnd',
            attributeValues: {
                ':pk': `S#${studentId}#R`, 
                ':skStart': `${dateStart.toDate().getTime()}#D`, 
                ':skEnd': `${dateEnd.toDate().getTime()}#D`
            }
        })
    ]);

    const trackedData: ReportDataStorage[] = [].concat(...trackedReports.map(x => x.data));

    if(!report.legend) {
        report.legend = [];
    }
    if(report.message) {
        if(typeof report.message != 'string') {
            report.message = JSON.stringify(report.message);
        }
    }

    console.log('Adding behaviors if missing', report.behaviors?.length, studentPii.behaviorLookup?.length);

    const reportBehaviorCount = report.behaviors.length;
    studentPii.behaviorLookup?.forEach(pii => {
        const original = report.behaviors.find(y => y.behaviorId == pii.id);
        const config = studentConfig.behaviors.find(x => x.id == pii.id);

        const weekData = trackedData.filter(x => x.behavior == pii.id && curWeekEpoc <= x.dateEpoc);
        const lastWeekCount = trackedData.filter(x => x.behavior == pii.id && x.dateEpoc < curWeekEpoc);
        const dayData = trackedData.filter(x => x.behavior == pii.id && requestDate.isSame(moment.tz(x.dateEpoc, timezone), 'day'));
        const prevDayData = trackedData.filter(x => x.behavior == pii.id && prevDate.isSame(moment.tz(x.dateEpoc, timezone), 'day'));
        console.log('Week data', pii.id, weekData.length, lastWeekCount.length);
        console.log('Day data', pii.id, dayData.length, prevDayData.length);

        let rb = report.behaviors.find(x => x.behaviorId == pii.id);
        if(!rb) {
            rb = {
                show: reportBehaviorCount == 0? true : original?.show? true : false,
                displayText: original?.displayText ?? pii.name,
                faces: original?.faces ?? [],
                behaviorId: pii.id,
                isDuration: false,
                targets: config?.targets,
            } as StudentSummaryReportBehavior;
            report.behaviors.push(rb);
        }
        rb.stats = {
            week: {
                count: weekData.length,
                delta: weekData.length - lastWeekCount.length,
                modifier: getModifier(weekData.length, lastWeekCount.length)
            },
            day: {
                count: dayData.length,
                delta: dayData.length - prevDayData.length,
                modifier: getModifier(dayData.length, prevDayData.length)
            }
        };
    });


    if(restrictions.behaviors) {
        report.behaviors = report.behaviors.filter(x => {
            return restrictions.behaviors!.find(y => y === x.behaviorId)? true : false;
        });
        report.legend = report.legend.filter(x => report.behaviors.find(y => x.behavior == y.behaviorId));
    }
    report.published = published;

    return report;
}


function getModifier(left: number, right: number) {
    if(left > right) {
        return '+';
    } else if(left < right) {
        return '-';
    } else {
        return '';
    }
}