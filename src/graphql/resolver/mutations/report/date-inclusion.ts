import {
    DataDal, Moment, TeamDal, WebError, WebUtils, generateDataKey, moment 
} from '@mytaptrack/lib';
import { MttAppSyncContext } from '@mytaptrack/cdk';

import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';
import { StudentConfigStorage } from '@mytaptrack/lib';

interface AppSyncParams {
  studentId: string;
  input: {
    startDate: number;
    endDate: number;
    exclude: string[];
    include: string[];
  }
}

const dataDal = new Dal('data');

export const handler = WebUtils.graphQLWrapper(handleEvent);

export async function handleEvent(context: MttAppSyncContext<AppSyncParams, never, never, {}>): Promise<boolean> {
    console.log('Handling Exclude and include event', context.arguments);
    
    const { studentId, input } = context.arguments;

    const excludeDates: Moment[] = input.exclude.filter(x => x? true : false).map(x => moment(x, 'MM/DD/yyyy'));
    const includeDates: Moment[] = input.include.filter(x => x? true : false).map(x => moment(x, 'MM/DD/yyyy'));
    const allDates = ([] as Moment[]).concat(excludeDates, includeDates);
    allDates.sort((a, b) => a.diff(b));

    let onDate = moment(input.startDate);
    let endDate = moment(input.endDate);
    if(onDate.isAfter(endDate)) {
        throw new WebError('Start date is after end date', 400);
    }

    if(onDate.weekday() != 0) {
        // Add excludes and includes from before start
    }
    const endOfPeriod = endDate.clone().endOf('week');
    if(!endDate.isSame(endOfPeriod, 'day')) {
        // Add excludes and includes from after end
    }
    endDate = endDate.add(-1, 'second');

    console.info('Processing dates', onDate.toDate(), endDate.toDate());
    while(onDate.isBefore(endDate, 'day')) {
        const date = onDate.clone();

        console.info('Checking if data exists', date.toDate());
        if(!await DataDal.checkDataExist(studentId, date)) {
            console.info('Data does not exist, creating empty report', date.toDate());
            await DataDal.saveEmptyReport(studentId, context.stash.permissions.license, date);
        }

        console.info('Getting excluded and included dates');
        const excludeDays = excludeDates.filter(x => x.isSame(date, 'week'));
        const includeDays = includeDates.filter(x => x.isSame(date, 'week'));

        console.info('Updating data', date.toDate());
        const pk = `S#${context.arguments.studentId}#R`;
        const sk = date.toDate().getTime() + '#D';
        await dataDal.update({
            key: { pk, sk },
            updateExpression: 'SET excludeDays = :excludeDays, includeDays = :includeDays',
            attributeValues: {
                ':excludeDays': excludeDays.map(d => d.format('MM/DD/yyyy')),
                ':includeDays': includeDays.map(d => d.format('MM/DD/yyyy'))
            }
        });

        onDate = onDate.add(1, 'week');
    }

    console.info('Processing complete');
    return true;
}
