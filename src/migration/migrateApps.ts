import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { AppConfigStorage, AppPiiGlobalStorage, AppPiiStorage, UserStudentTeam, WebUtils, getAppGlobalKey } from "@mytaptrack/lib";
import { LicenseAppConfigStorage, LicenseAppPiiStorage, getAppGlobalV2Key } from "../graphql/resolver/types";
import { Dal } from "@mytaptrack/lib/dist/v2/dals/dal";

const data = new Dal('data');
const primary = new Dal('primary');

const studentLicenseMap: {[key: string]: string } = {};

export const onCreate = WebUtils.lambdaWrapper(onCreateHandler);

export async function onCreateHandler(event) {
    console.log('Event: ', event);

    // const promises: any[] = [];
    // const tableName = process.env.DataTable;
    const appConfigs: LicenseAppConfigStorage[] = [];
    const appPiis: LicenseAppPiiStorage[] = [];
    
    let token: any;
    do {
        console.info('Getting records');
        const scanResults = await data.scan<AppConfigStorage[]>({
            filterExpression: 'begins_with(pk, :pkVal) AND begins_with(sk, :skVal)',
            attributeValues: {
                ':pkVal': 'S#',
                ':skVal': 'AS#'
            },
            token
        });

        token = scanResults.token;

        if (scanResults.items && scanResults.items.length > 0) {
            for (let item of scanResults.items) {
                console.info('Processing', item.pk, item.sk);
                if(!item.sk.endsWith('#P')) {
                    continue;
                }
                
                if(item.deleted) {
                    continue;
                }

                let config = appConfigs.find(x => x.deviceId == item.deviceId);
                let pii = appPiis.find(x => x.deviceId == item.deviceId);

                if(!config) {
                    const key = getAppGlobalV2Key(item.license, item.deviceId);
                    console.info('Storing app data', key);
                    const [originalGlobalConfig, appPii] = await Promise.all([
                        primary.get<AppPiiGlobalStorage>(getAppGlobalKey(item.license, item.deviceId)),
                        primary.get<AppPiiStorage>({ pk: item.pk, sk: item.sk })
                    ]);
    
                    const newConfig: LicenseAppConfigStorage = {
                        ...key,
                        pksk: `${key.pk}#${key.sk}`,
                        deviceId: item.deviceId,
                        dsk: key.pk,
                        auth: [item.config.auth],
                        license: item.license,
                        textAlerts: item.config.textAlerts,
                        timezone: item.config.timezone ?? '',
                        students: [{
                            studentId: item.studentId,
                            behaviors: item.config.behaviors.map(b => ({
                                id: b.id,
                                abc: b.abc,
                                order: b.order
                            })),
                            services: []
                        }],
                        studentIds: [item.studentId],
                    };
                    appConfigs.push(newConfig);
                    config = newConfig;
    
                    const newPii: LicenseAppPiiStorage = {
                        ...key,
                        pksk: `${key.pk}#${key.sk}`,
                        lpk: `${item.license}#APP`,
                        lsk: `${item.deviceId}`,
                        deviceId: item.deviceId,
                        license: item.license,
                        deviceName: originalGlobalConfig?.deviceName ?? 'Unnamed',
                        studentContextLookup: [{
                            id: item.studentId,
                            name: appPii.studentName,
                            groups: appPii.groups
                        }],
                        studentIds: [item.studentId],
                        tags: []
                    };
                    appPiis.push(newPii);
                    pii = newPii;
                } else {
                    const eStudent = config.students.find(s => s.studentId == item.studentId);
                    if(!eStudent) {
                        console.info('Adding new student to existing config', config.deviceId);
                        config.auth.push(item.config.auth);
                        config.students.push({
                            studentId: item.studentId,
                            behaviors: item.config.behaviors.map(b => ({
                                id: b.id,
                                abc: b.abc,
                                order: b.order
                            })),
                            services: []
                        });
                        config.studentIds.push(item.studentId);

                        const appPii = await primary.get<AppPiiStorage>({ pk: item.pk, sk: item.sk });
                        pii.studentContextLookup.push({
                            id: item.studentId,
                            name: appPii.studentName,
                            groups: appPii.groups
                        });
                        pii.studentIds.push(item.studentId);
                    } else {
                        config.auth.push(item.config.auth);
                        
                    }
                }
                

                await data.send(new TransactWriteCommand({
                    TransactItems: [
                        {
                            Put: {
                                TableName: data.tableName,
                                Item: config
                            }
                        },
                        {
                            Put: {
                                TableName: primary.tableName,
                                Item: pii
                            }
                        }
                    ]
                }));
            }
        }
    } while (token);

    return { physicalResourceId: 'migrate-team-data-complete' };
}
