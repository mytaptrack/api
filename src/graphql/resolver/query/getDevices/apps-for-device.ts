import { MttAppSyncContext } from '@mytaptrack/cdk';
import {
    AppConfigStorage, AppPii, AppPiiStorage, StudentConfigStorage, StudentPiiStorage,
    WebError, WebUtils, generateDataKey, getAppGlobalKey, getStudentAppKey, getStudentPrimaryKey,
    moment
} from '@mytaptrack/lib';
import { Dal, DalKey, MttIndexes } from '@mytaptrack/lib/dist/v2/dals/dal';
import { GraphQLAppServiceItem, GraphQLAppStudentEx, QLAppDeviceConfiguration } from '@mytaptrack/types';
import { LicenseAppConfigStorage, LicenseAppConfigStorageStudent, LicenseAppPiiStorage, getAppGlobalV2Key } from '../../types';
import { TransactWriteCommand, TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { StudentReportStorage } from '../../types/reports';
import { getLastTracked, processNotStopped, processNotStoppedService } from './track-for-dsn';
import { v4 as uuid } from 'uuid';

export const handler = WebUtils.graphQLWrapper(handleEvent);

const data = new Dal('data');
const primary = new Dal('primary');

interface AppSyncParams {
    deviceId: string;
    auth: string;
    apps: { id: string, auth: string }[];
}
interface LicenseAppConfigStorageStudentEx extends LicenseAppConfigStorageStudent {
    deviceId: string;
}

export async function handleEvent(context: MttAppSyncContext<AppSyncParams, any, any, {}>): Promise<QLAppDeviceConfiguration> {
    const deviceId = context.arguments.deviceId;
    let auth = context.arguments.auth;
    const apps = context.arguments.apps;

    console.info('Getting app config');
    let deviceAppConfigs = await data.query<LicenseAppConfigStorage>({
        keyExpression: 'deviceId = :deviceId and begins_with(dsk, :sk)',
        attributeValues: {
            ':deviceId': deviceId,
            ':sk': 'L#'
        },
        attributeNames: {
            '#deleted': 'deleted'
        },
        filterExpression: 'attribute_not_exists(#deleted)',
        indexName: MttIndexes.device
    });

    let devicePii: LicenseAppPiiStorage;
    let deviceAppConfig: LicenseAppConfigStorage;
    let unsetAuths: LicenseAppConfigStorage[] = [];

    if (deviceAppConfigs.length == 0 && apps?.length > 0) {
        console.info('No app config found');
        let appData: LicenseAppConfigStorage;
        let offset = 0;

        while(!appData && offset < apps.length) {
            console.info('Evaluating app id', apps[offset].id);
            const unclaimedApps = await data.query<LicenseAppConfigStorage>({
                keyExpression: 'deviceId = :deviceId',
                attributeValues: {
                    ':deviceId': apps[offset].id,
                },
                attributeNames: {
                    '#deleted': 'deleted'
                },
                filterExpression: 'attribute_not_exists(#deleted)',
                indexName: MttIndexes.device
            });

            console.log('Evaluating auth');
            console.debug('unclaimedApps', unclaimedApps);
            if(unclaimedApps.length == 1 && !unclaimedApps[0].auth.find(a => a == apps[offset].auth)) {
                appData = unclaimedApps[0];
                console.info('Authentication failed', apps[offset].auth, unclaimedApps[0].auth);
                appData = undefined;
            } else {
                appData = unclaimedApps[0];
            }
            offset++;
        }
        console.info('App search complete');

        if(appData) {
            console.log('App found', appData.deviceId);
            const transactionInput: TransactWriteCommandInput = {
                TransactItems: []
            };

            console.log('Getting pii');
            const appPii = await primary.get<LicenseAppPiiStorage>({
                pk: appData.pk,
                sk: appData.sk
            });

            console.log('Getting index of app');
            const appOffset = apps.findIndex(x => x.id == appData.deviceId);

            console.info('Creating device');
            transactionInput.TransactItems.push({
                Delete: {
                    TableName: data.tableName,
                    Key: { pk: appData.pk, sk: appData.sk }
                }
            });
            transactionInput.TransactItems.push({
                Delete: {
                    TableName: primary.tableName,
                    Key: { pk: appData.pk, sk: appData.sk }
                }
            });
            appData.sk = `GD#${deviceId}`;
            appData.deviceId = deviceId;
            appData.pksk = `${appData.pk}#${appData.sk}`;
            appPii.sk = appData.sk;
            appPii.pksk = appData.pksk;
            appPii.deviceId = appData.deviceId;

            transactionInput.TransactItems.push({
                Put: {
                    TableName: data.tableName,
                    Item: appData
                }
            });
            transactionInput.TransactItems.push({
                Put: {
                    TableName: primary.tableName,
                    Item: appPii
                }
            });
            deviceAppConfig = appData;
            deviceAppConfigs = [appData];
            devicePii = appPii;
            if(!devicePii) {
                devicePii = {
                    pk: deviceAppConfig.pk,
                    sk: deviceAppConfig.sk,
                    pksk: deviceAppConfig.pksk,
                    deviceId: deviceAppConfig.deviceId,
                    license: deviceAppConfig.license,
                    lpk: ``,
                    lsk: ``,
                    deviceName: '',
                    dsk: '',
                    studentContextLookup: [],
                    studentIds: [],
                    tags: [],
                    textAlerts: true,
                    timezone: deviceAppConfig.timezone
                };
            }

            console.info('Sending transaction');
            await data.send(new TransactWriteCommand(transactionInput));

            console.info('Removing loaded app from apps list');
            apps.splice(appOffset, 1);
        } else {
            return {
                deviceId: deviceId,
                license: '',
                textAlerts: true,
                name: '',
                identity: '',
                timezone: '',
                studentConfigs: [],
            };
        }
    }

    if (deviceAppConfigs.length > 0) {
        deviceAppConfig = deviceAppConfigs[0];
        devicePii = await primary.get<LicenseAppPiiStorage>({ pk: deviceAppConfig.pk, sk: deviceAppConfig.sk });

        console.info('getting unsetAuths');
        const unsetAuths = deviceAppConfigs.filter(x => x.auth && x.auth.length > 0 ? false : true);
        // if (auth && unsetAuths.length != deviceAppConfigs.length &&
        //     !deviceAppConfigs.find(x => x.auth.find(a => a == auth))) {
        //     console.info('Authentication failed', unsetAuths.length, deviceAppConfigs.length);
        //     throw new WebError('Access Denied', 403);
        // }

        if (!auth) {
            console.info('Creating identity');
            auth = (deviceAppConfigs.find(x => x.auth && x.auth.length > 0)?.auth[0]) ?? uuid();
        }

        console.info('Pii and student apps retrieved', deviceAppConfigs.length);
        console.debug('deviceAppConfigs', deviceAppConfigs);
        console.debug('devicePii', devicePii);
        let updated = false;

        if (apps && apps.length > 0) {
            const updates: LicenseAppConfigStorage[] = [];
            const creates: LicenseAppConfigStorage[] = [];
            const createPiis: LicenseAppPiiStorage[] = [];
            console.log('Getting apps');
            await Promise.all(apps
                .map(async a => {
                    const unclaimedApps = await data.query<LicenseAppConfigStorage>({
                        keyExpression: 'deviceId = :deviceId',
                        attributeValues: {
                            ':deviceId': a.id,
                        },
                        attributeNames: {
                            '#deleted': 'deleted'
                        },
                        filterExpression: 'attribute_not_exists(#deleted)',
                        indexName: MttIndexes.device
                    });

                    if (unclaimedApps.length == 0) {
                        console.warn('No apps found for device', a.id);
                        return;
                    }

                    console.info('Processing unclaimed results');
                    await Promise.all(unclaimedApps.map(async r => {
                        console.debug('r', r);
                        if (!r.auth?.find(x => x == a.auth) || r.qrExpiration < new Date().getTime()) {
                            console.info('QR Expired', r.deviceId);
                            return;
                        }

                        console.info('Processing device', r.deviceId);
                        const existing = deviceAppConfigs.find(x => x.license == r.license);
                        if (existing) {
                            console.info('Evaluating existing app');
                            if (!existing.students) {
                                existing.students = [];
                            }

                            await Promise.all(r.students.map(async s => {
                                const es = existing.students.find(x => x.studentId == s.studentId);
                                if (es) {
                                    console.log('Modifying existing student');
                                    s.behaviors?.forEach(b => {
                                        if (!es.behaviors?.find(x => x.id == b.id)) {
                                            updated = true;
                                            es.behaviors.push(b);
                                        }
                                    });
                                    s.services?.forEach(b => {
                                        if (!es.services?.find(x => x.id == b.id)) {
                                            updated = true;
                                            es.services.push(b);
                                        }
                                    });
                                } else {
                                    console.info('Adding student', s.studentId);
                                    updated = true;
                                    existing.students.push(s);

                                    console.info('Getting temp device pii');
                                    const pii = await primary.get<LicenseAppPiiStorage>({ pk: r.pk, sk: r.sk });

                                    console.info('Process new student context merge');
                                    console.debug('pii', pii);
                                    pii.studentContextLookup.forEach(sPii => {
                                        if (devicePii.studentContextLookup.find(x => x.id == sPii.id)) {
                                            return;
                                        }

                                        console.info('Adding student pii', sPii.id);
                                        devicePii.studentContextLookup.push(sPii);
                                    });
                                }
                            }));

                            console.info('Adding to updates');
                            updates.push(r);
                        } else {
                            console.log('Getting pii for app');
                            const pii = await primary.get<LicenseAppPiiStorage>({ pk: r.pk, sk: r.sk });
                            console.info('Adding app to deviceAppConfigs');
                            creates.push(r);
                            createPiis.push(pii);
                            deviceAppConfigs.push(r);

                        }
                    }));
                }));

            console.log('Evaluating updates and creates', updates.length, creates.length);

            if (updates.length > 0 || creates.length > 0) {
                const transactionInput: TransactWriteCommandInput = {
                    TransactItems: []
                };


                if (updates.length > 0) {
                    console.info('Add updates', updates.length);
                    updates.forEach(x => {
                        transactionInput.TransactItems.push({
                            Delete: {
                                TableName: data.tableName,
                                Key: { pk: x.pk, sk: x.sk }
                            }
                        });
                        transactionInput.TransactItems.push({
                            Delete: {
                                TableName: primary.tableName,
                                Key: { pk: x.pk, sk: x.sk }
                            }
                        });
                    });
                    transactionInput.TransactItems.push({
                        Update: {
                            TableName: data.tableName,
                            Key: { pk: deviceAppConfig.pk, sk: deviceAppConfig.sk },
                            UpdateExpression: 'SET students = :students, studentIds = :studentIds',
                            ExpressionAttributeValues: {
                                ':students': deviceAppConfig.students,
                                ':studentIds': deviceAppConfig.students.map(y => y.studentId)
                            }
                        }
                    });

                    transactionInput.TransactItems.push({
                        Update: {
                            TableName: primary.tableName,
                            Key: { pk: devicePii.pk, sk: devicePii.sk },
                            UpdateExpression: 'SET studentContextLookup = :studentContextLookup, studentIds = :studentIds',
                            ExpressionAttributeValues: {
                                ':studentContextLookup': devicePii.studentContextLookup,
                                ':studentIds': deviceAppConfig.students.map(y => y.studentId)
                            }
                        }
                    });
                }

                console.log('Adding creates', creates.length);
                creates.forEach(x => {
                    const newGlobalKey = getAppGlobalV2Key(x.license, deviceId);
                    if (transactionInput.TransactItems.find(y => y.Delete.Key.sk == x.sk)) {
                        transactionInput.TransactItems.push({
                            Delete: {
                                TableName: data.tableName,
                                Key: { pk: x.pk, sk: x.sk }
                            }
                        });
                        transactionInput.TransactItems.push({
                            Delete: {
                                TableName: primary.tableName,
                                Key: { pk: x.pk, sk: x.sk }
                            }
                        });
                    }
                    transactionInput.TransactItems.push({
                        Put: {
                            TableName: data.tableName,
                            Item: {
                                ...x,
                                ...newGlobalKey,
                                pksk: `${newGlobalKey.pk}#GD#${deviceId}`,
                                deviceId: deviceId,
                                lsk: `GD#${deviceId}`,
                                tsk: `GD#${deviceId}`
                            } as LicenseAppConfigStorage
                        }
                    });

                    const pii = createPiis.find(y => y.pk == x.pk && y.sk == x.sk);
                    transactionInput.TransactItems.push({
                        Put: {
                            TableName: primary.tableName,
                            Item: {
                                ...pii,
                                ...newGlobalKey,
                                pksk: `${newGlobalKey.pk}#${newGlobalKey.sk}`,
                                deviceId: deviceId,
                                lsk: `P#${deviceId}`,
                                tsk: `DA#${deviceId}#P`,
                            } as LicenseAppPiiStorage
                        }
                    });
                });
                console.info('Sending transaction');
                console.debug('transactionInput', transactionInput);
                await data.send(new TransactWriteCommand(transactionInput));
            }
        }
    }

    const studentKeys: DalKey[] = [];
    const appPiiKeys: DalKey[] = [];
    const studentAppConfigs: LicenseAppConfigStorageStudentEx[] = [];
    console.info('Processing deviceAppConfigs', deviceAppConfigs.length);
    deviceAppConfigs.forEach(dac => {
        if (dac.deleted) {
            return;
        }
        dac.students.forEach(sac => {
            const key = getStudentPrimaryKey(sac.studentId)
            if (!studentKeys.find(x => x.pk == key.pk)) {
                studentKeys.push(key);
            }

            const piiKey = getAppGlobalKey(dac.license, deviceId);
            if (!appPiiKeys.find(x => x.pk == piiKey.pk && x.sk == piiKey.sk)) {
                appPiiKeys.push(piiKey);
            }
            studentAppConfigs.push({
                ...sac,
                deviceId: dac.deviceId
            });
        });
    });

    console.debug('Student Keys', studentKeys);

    const [devicePiis, students, studentConfigs] = await Promise.all([
        primary.batchGet<LicenseAppPiiStorage>(deviceAppConfigs.map(sac => ({ pk: sac.pk, sk: sac.sk })), 'studentContextLookup, deviceName'),
        primary.batchGet<StudentPiiStorage>(studentKeys, 'studentId, behaviorLookup, responseLookup, servicesLookup, abc, nickname, firstName, lastName'),
        data.batchGet<StudentConfigStorage>(studentKeys, 'studentId, abc, behaviors, responses, services, license'),
    ]);

    console.debug('devicePiis', devicePiis);
    const studentPiis: { [key: string]: { id: string, name: string, groups: string[] } } = {};
    devicePiis.forEach(dp => {
        dp.studentContextLookup?.forEach(sp => {
            studentPiis[sp.id] = sp;
        });
    });

    console.debug('App Configs', deviceAppConfigs);
    console.debug('App Pii', devicePiis);
    console.debug('Student Pii', students);
    console.debug('Student Configs', studentConfigs);

    const retval: QLAppDeviceConfiguration = {
        deviceId: deviceId,
        name: devicePii?.deviceName ?? '',
        license: students[0]?.license ?? '',
        textAlerts: true,
        identity: auth,
        timezone: '',
        studentConfigs: (await Promise.all(studentAppConfigs
            .filter(sac => !sac.deleted)
            .map(async sac => {
                console.info('Constructing app for student', sac.studentId);
                let studentAppPii = studentPiis[sac.studentId];
                const student = students.find(x => x.studentId == sac.studentId);
                if(!studentAppPii) {
                    studentAppPii = {
                        id: student.studentId,
                        name: `${student.firstName} ${student.lastName}`,
                        groups: []
                    };
                    studentPiis[sac.studentId] = studentAppPii;
                }
                const studentConf = studentConfigs.find(x => x.studentId == sac.studentId);
                if (!studentAppPii || !student || !studentConf) {
                    console.info('Could not process student ', sac.studentId,
                        'studentAppPii', studentAppPii ? true : false,
                        'student', student ? true : false,
                        'studentConf', studentConf ? true : false);
                    return;
                }
                const report = await data.get<StudentReportStorage>(generateDataKey(student.studentId, moment().startOf('week').toDate().getTime()))

                return {
                    id: sac.deviceId,
                    studentId: sac.studentId,
                    studentName: studentAppPii.name,
                    license: studentConf.license,
                    abc: student.abc,
                    groups: studentAppPii.groups,
                    behaviors: sac.behaviors?.map(sacb => {
                        const bPii = student.behaviorLookup?.find(x => x.id == sacb.id);
                        const bConf = studentConf.behaviors?.find(x => x.id == sacb.id);
                        if (!bPii || !bConf) {
                            return;
                        }
                        const lastTracked = getLastTracked(report?.data, sacb.id, bConf.isDuration);
                        return {
                            id: sacb.id,
                            isDuration: bConf.isDuration,
                            abc: sacb.abc ? true : false,
                            order: sacb.order,
                            name: bPii.name ?? 'No name provided',
                            lastStart: lastTracked?.dateEpoc,
                            notStopped: lastTracked?.notStopped ?? false,
                            intensity: sacb.intensity? true : undefined,
                            maxIntensity: sacb.intensity? bConf.intensity : null
                        };
                    }).filter(x => x ? true : false) ?? [],
                    responses: sac.behaviors.map(sacb => {
                        const response = student.responseLookup?.find(x => x.id == sacb.id);
                        const rConf = studentConf.responses?.find(x => x.id == sacb.id);
                        if (!response || !rConf) {
                            return;
                        }
                        const lastTracked = getLastTracked(report?.data, sacb.id, rConf.isDuration);
                        return {
                            id: sacb.id,
                            isDuration: rConf.isDuration,
                            abc: false,
                            order: sacb.order,
                            name: response?.name ?? '',
                            lastStart: lastTracked?.notStopped ? lastTracked?.dateEpoc : undefined,
                            notStopped: lastTracked?.notStopped ?? false
                        };
                    }).filter(x => x ? true : false) ?? [],
                    services: sac.services?.map(sacb => {
                        const service = student.servicesLookup.find(x => x.id == sacb.id);
                        const serviceConf = studentConf.services.find(x => x.id == sacb.id);
                        if (!service || !serviceConf) {
                            return;
                        }

                        return {
                            id: sacb.id,
                            order: sacb.order,
                            name: service?.name ?? 'Unnamed',
                            percentage: serviceConf.goals.trackGoalPercent,
                            trackedItems: serviceConf.goals.goalTargets.map(x => x.name),
                            modifications: service.modifications.map(x => x.name),
                            notStopped: processNotStoppedService(report?.services, sacb.id, serviceConf.isDuration)
                        } as GraphQLAppServiceItem;
                    }).filter(x => x ? true : false) ?? []
                } as GraphQLAppStudentEx;
            })
        )).filter(sac => { return !sac ? false : true })
    };

    console.debug('studentConfigs', retval.studentConfigs);
    retval.studentConfigs.sort((a, b) => a.studentName.localeCompare(b.studentName));
    retval.studentConfigs.forEach(s => {
        s.behaviors.sort((a, b) => a.order - b.order);
        s.responses.sort((a, b) => a.order - b.order);
        s.services.sort((a, b) => a.order - b.order);
    });

    console.debug('retval', retval);

    if (unsetAuths.length > 0) {
        await Promise.all(unsetAuths.map(c => {
            return data.update({
                key: { pk: c.pk, sk: c.sk },
                updateExpression: 'SET #auth = :auth',
                attributeNames: {
                    '#auth': 'auth'
                },
                attributeValues: {
                    ':auth': [auth]
                }
            });
        }));
    }

    return retval;
}