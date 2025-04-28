
import { AccessLevel, QLReportData, QLReportDataSource, QLReportDetails, QLReportService } from '@mytaptrack/types';
import { MttAppSyncContext } from '@mytaptrack/cdk';
import { StudentReportStorage } from '../../types/reports';
import { AppPiiGlobal, DevicePiiGlobalStorage, LookupDal, Moment, UserDataStorage, UserPrimaryStorage, WebError, WebUtils, generateDeviceGlobalKey, getAppGlobalKey, getStudentPrimaryKey, getUserPrimaryKey, moment } from '@mytaptrack/lib';
import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';
import { utils, WorkSheet, write } from 'xlsx';

const dataDal = new Dal('data');
const primaryDal = new Dal('primary');

interface Params {
    studentId: string;
    startDate: string;
    endDate: string;
    timezone: string;
    reportType: string;
}

export const handler = WebUtils.graphQLWrapper(handleEvent);

async function handleEvent(context: MttAppSyncContext<Params, never, never, {}>) {
    const startDate: Moment = moment(context.arguments.startDate);
    const endDate: Moment = moment(context.arguments.endDate);

    const student = await this.user.loadStudent(this.studentId);
    if(!student) {
        throw new WebError('Could not retrieve the student specified');
    }

    const weeks: moment.Moment[] = [];
    if(this.selection === 'week') {
    weeks.push(this.downloadDate)
    } else if(this.selection === 'month') {
    let date = this.downloadDate;
    do {
        weeks.push(date);
        date = date.clone().add(1, 'week');
    } while (date < this.downloadEndDate);
    } else {
    let date = this.downloadDate;
    const endDate = this.downloadDate.clone().add(-1, 'day');
    this.downloadEndDate = endDate;
    do {
        weeks.push(date);
        date = date.clone().add(1, 'week');
    } while (date < endDate);
    }
    this.completePercent = 10;

    if(this.reportType === 'data') {
    const reportData = weeks.map(date => {
        this.completePercent += 20 / weeks.length;
        return this.getReportCsvData(student, date);
    });

    this.completePercent = 15;
    let fileData = [['Activity', 'Date', 'Activity Begins', 'Activity Ends', 'Behavior', 'Timestamp', 'Duration (Seconds)', 'Start/Stop']];

    for(const i in reportData) {
        fileData.push(...await reportData[i]);
        this.completePercent += 55 / weeks.length;
    }
    const sheet = utils.aoa_to_sheet(fileData);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, sheet, 'Data');

    let data = write(wb, {
        bookType: 'xlsx',
        bookSST: false,
        type: 'array'
    });
    const downloadDate = moment(this.downloadDate);
    return new Blob([data], {type:"application/octet-stream"});
    } else {
    if(this.startHour as any instanceof String) {
        this.startHour = parseInt(this.startHour as any);
    }
    if(this.endHour as any instanceof String) {
        this.endHour = parseInt(this.endHour as any);
    }
    const reportData = weeks.map(async date => {
        const retval = await this.getWorksheets(student, date);
        this.completePercent += 20 / weeks.length;
        return retval;
    });

    this.completePercent = 15;
    const sheets = [];
    for(const i in reportData) {
        const result = await reportData[i];
        sheets.push(...result);
        this.completePercent += 55 / weeks.length;
    }
    sheets.sort((a, b) => { return a.sort - b.sort; } );
    const wb = utils.book_new();
    sheets.forEach(sheet => { utils.book_append_sheet(wb, sheet.sheet, sheet.name); });
        let data = write(wb, {
        bookType: 'xlsx',
        bookSST: false,
        type: 'array'
        });
    
    return new Blob([data], {type:"application/octet-stream"});    
    }
}
