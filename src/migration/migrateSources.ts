import { AppConfigStorage, DataDal, DataStorage, StudentConfig, StudentDal, StudentDashboardSettingsStorage, WebUtils, moment } from "@mytaptrack/lib";
import { LicenseAppConfigStorage, LicenseAppPiiStorage, getAppGlobalV2Key } from "../graphql/resolver/types";
import { Dal } from "@mytaptrack/lib/dist/v2/dals/dal";
import { StudentReportStorage } from "../graphql/resolver/types/reports";
import { BehaviorCalculation } from "@mytaptrack/types";

const data = new Dal('data');
const primary = new Dal('primary');

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
                if(!resp.pk.endsWith('#R') || resp.version == 4) {
                    continue;
                }

                if(!resp.data) {
                    continue;
                }

                console.log('Upgrading report sources', resp.pk, resp.sk);
                const dataSources: { device: string, rater?: string }[]= [];
                resp.data.forEach(dataItem => {
                    if(dataItem.source && dataItem.source.device == 'App' && !dataSources.find(x => x.rater == dataItem.source.rater)) {
                        dataSources.push(dataItem.source);
                    }
                });

                if(dataSources.length == 0) {
                    console.log('No data sources');
                    continue;
                }

                console.info('Retrieving data sources');
                const sources = await data.batchGet<AppConfigStorage>(dataSources.map(x => ({ pk: resp.pk.replace('#R', ''), sk: `AS#${x.rater}#P`})));
                let updated = false;
                console.info('Updating report');
                resp.data.forEach(dataItem => {
                    const item = sources.find(x => x.appId == dataItem.source.rater);
                    if(item) {
                        dataItem.source.rater = item.deviceId;
                        updated = true;
                    }
                });
                if(updated) {
                    console.info('Report being updated in dynamo');
                    await data.update({
                        key: { pk: resp.pk, sk: resp.sk },
                        updateExpression: 'SET #data = :data, #version = :version',
                        attributeNames: {
                            '#data': 'data',
                            '#version': 'version'
                        },
                        attributeValues: {
                            ':data': resp.data,
                            ':version': 4
                        
                        }
                    });
                }
                console.info('Report update complete');
            }
        }
    } while (token);

    console.log('Waiting for final promises to finish');
    await Promise.all(promises);

    console.log('Returning result');
    return { physicalResourceId: 'migrate-report-data-complete' };
}
