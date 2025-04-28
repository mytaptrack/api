import { DataDal, DataStorage, StudentConfig, StudentDal, StudentDashboardSettingsStorage, WebUtils, moment } from "@mytaptrack/lib";
import { LicenseAppConfigStorage, LicenseAppPiiStorage, getAppGlobalV2Key } from "../graphql/resolver/types";
import { Dal } from "@mytaptrack/lib/dist/v2/dals/dal";
import { StudentReportStorage } from "../graphql/resolver/types/reports";
import { BehaviorCalculation } from "@mytaptrack/types";

const data = new Dal('data');
const primary = new Dal('primary');

const studentLicenseMap: {[key: string]: string } = {};

export const onCreate = WebUtils.lambdaWrapper(onCreateHandler);

export async function onCreateHandler(event) {
    console.log('Event: ', event);

    const promises: any[] = [];
    
    const studentLookup: { [key: string]: { student: StudentConfig, independent: string[]} } = {};
    let token: any;
    do {
        console.log('Scanning db');
        const scanResults = await data.scan<DataStorage[]>({
            filterExpression: 'begins_with(pk, :pkVal)',
            attributeValues: {
                ':pkVal': 'S#'
            },
            token
        });
        token = scanResults.token;

        // const queryResults = await data.query<DataStorage>({
        //     keyExpression: 'pk = :pk and sk = :sk',
        //     attributeValues: {
        //         ':pk': 'S#df06cb69-0517-4789-a6e9-8ee989ea66a4#R',
        //         ':sk': '1630195200000#D'
        //     }
        // });
        // const scanResults = {
        //     items: queryResults
        // };

        console.log('Reports ', scanResults.items?.length);
        if (scanResults.items && scanResults.items.length > 0) {
            for (let resp of scanResults.items) {
                if(!resp.pk.endsWith('#R') || resp.version == 3) {
                    continue;
                }
                console.log('Fixing report');
                const sidStartIndex = resp.pk.indexOf('#') + 1;
                const sidEndIndex = resp.pk.indexOf('#', sidStartIndex);
                const studentId = resp.pk.slice(sidStartIndex, sidEndIndex);
                if(!studentLookup[studentId]) {
                    console.log('Getting student information', studentId);
                    const lookupItem: { student: StudentConfig, independent: string[] } = {
                        student: await StudentDal.getStudentConfig(studentId),
                        independent: []
                    };
                    if(!lookupItem?.student) {
                        console.log('Could not find student ', studentId);
                        continue;
                    }
                    console.log('Processing independent data sources');
                    lookupItem.independent = lookupItem.student.dashboard?.devices.filter(x => x.calculation == BehaviorCalculation.Independent || x.calculation == BehaviorCalculation.Hidden).map(x => x.id) ?? [];
                    studentLookup[studentId] = lookupItem;
                }
                console.log('Getting student and data source seperation');
                let { student, independent } = studentLookup[studentId];

                console.log('Constructing upgraded data');
                const upgradedData: StudentReportStorage = {
                    ...resp,
                    data: [],
                    services: [],
                    schedules: Array.isArray(resp.schedules)? resp.schedules : Object.keys(resp.schedules).map(key => {
                        return {
                            date: key,
                            schedule: resp.schedules[key]
                        }
                    }),
                    studentId,
                    tsk: `R#${resp.startMillis}`,
                    lpk: `${resp.license}#R`,
                    lsk: `S#${studentId}#R#${resp.startMillis}`,
                    endMillis: moment(new Date(resp.startMillis)).add(7, 'days').toDate().getTime(),
                    version: 2
                };

                console.log('Constructing data')
                resp.data.forEach((item, index) => {
                    if(item['ignore']) {
                        console.log('Ignoring data that has already been processed');
                        return;
                    }
                    let duration: number | undefined = item['duration'];

                    if((duration == undefined || duration == -1) && student.behaviors.find(x => x.id == item.behavior)?.isDuration) {
                        const isIndependent = (item.source?.rater)? independent.includes(item.source!.rater!) : false;
                        console.log('Finding duration end', item.behavior, item.dateEpoc, isIndependent, index, JSON.stringify(resp.data));
                        const nextItem = resp.data.find((d, ni) => 
                            index < ni && 
                            d.behavior == item.behavior && 
                            (!isIndependent || item.source?.rater == d.source?.rater)
                        );
                        console.log('')
                        if(nextItem && moment(new Date(nextItem.dateEpoc)).isSame(moment(new Date(item.dateEpoc)), 'day')) {
                            console.log('Found end');
                            duration = nextItem.dateEpoc - item.dateEpoc;
                            nextItem['ignore'] = true;
                        } else {
                            console.log('No end found');
                            duration = -1;
                        }
                    }
                    console.log('Adding item to data set');
                    upgradedData.data.push({
                        abc: item.abc,
                        behavior: item.behavior,
                        dateEpoc: item.dateEpoc,
                        deleted: item.deleted,
                        isManual: item.isManual,
                        reported: item.reported!,
                        score: item.score,
                        source: item.source? {
                            rater: item.source!.rater!,
                            device: item.source!.device
                        } : {
                            rater: 'Unknown',
                            device: 'Web'
                        },
                        duration: duration
                    });
                });

                console.log('Putting update in db');
                promises.push(data.put(upgradedData));
                if(promises.length > 20) {
                    console.log('Waiting for current db updates to finish');
                    await Promise.all(promises);
                    console.log('Clearing db promise array');
                    promises.splice(0);
                }
            }

        }
    } while (token);

    console.log('Waiting for final promises to finish');
    await Promise.all(promises);

    console.log('Returning result');
    return { physicalResourceId: 'migrate-report-data-complete' };
}
