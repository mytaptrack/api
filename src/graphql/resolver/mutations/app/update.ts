import {
    WebUtils, AppPiiGlobalStorage, isEqual, StudentDal
} from '@mytaptrack/lib';
import {
    MttAppSyncContext
} from '@mytaptrack/cdk';
import {
    GraphQLAppInput, GraphQLAppOutput, QLApp
} from '@mytaptrack/types';
import {
    TransactWriteCommand, TransactWriteCommandInput, UpdateCommandInput
} from '@aws-sdk/lib-dynamodb';
import { uuid } from 'short-uuid';
import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';
import { LicenseAppConfigStorage, LicenseAppConfigStorageStudent, LicenseAppPiiStorage, getAppGlobalV2Key } from '../../types';

const dataDal = new Dal('data');
const primaryDal = new Dal('primary');

export interface AppSyncParams {
    appConfig: GraphQLAppInput;
}

function cleanObject(obj: any) {
    if(!obj) {
        return;
    }

    if(typeof obj == 'object') {
        Object.keys(obj).forEach(key => {
            if(obj[key] == undefined) {
                delete obj[key];
            }
            cleanObject(obj[key]);
        });
    }

    return obj;
}

export const handler = WebUtils.graphQLWrapper(handleEvent);

export async function handleEvent(context: MttAppSyncContext<AppSyncParams, never, never, never>): Promise<GraphQLAppOutput> {
    console.log('Processing updating app');
    console.debug('appConfig', context.arguments.appConfig);
    const source = context.arguments.appConfig;

    const commands = {
        TransactItems: []
    } as TransactWriteCommandInput;

    let originalKey = getAppGlobalV2Key(source.license, source.deviceId);

    if(source.deleted) {
        console.info(`Setting deleted flag for ${source.deviceId}`);
        commands.TransactItems = [];
        commands.TransactItems.push({
            Update: {
                TableName: primaryDal.tableName,
                Key: originalKey,
                UpdateExpression: 'SET #deleted = :deleted',
                ExpressionAttributeNames: {
                    '#deleted': 'deleted'
                },
                ExpressionAttributeValues: {
                    ':deleted': {
                        by: context.identity.username,
                        date: new Date().getTime(),
                        client: 'Web'
                    }
                }
            }
        });
        commands.TransactItems.push({
            Update: {
                TableName: dataDal.tableName,
                Key: originalKey,
                UpdateExpression: 'SET #deleted = :deleted',
                ExpressionAttributeNames: {
                    '#deleted': 'deleted'
                },
                ExpressionAttributeValues: {
                    ':deleted': {
                        by: context.identity.username,
                        date: new Date().getTime(),
                        client: 'Web'
                    }
                }
            }
        });

        console.debug('commands', commands);
        
        await primaryDal.send(new TransactWriteCommand(commands));
        return { deviceId: source.deviceId };
    }

    let isNew = false;
    if(!source.deviceId) {
        source.deviceId = `MLC-${uuid()}`;
        originalKey = getAppGlobalV2Key(source.license, source.deviceId);
        isNew = true;
    }
    if(!source.tags) {
        source.tags = [];
    }

    const [devicePiiStorage, deviceConfigStorage] = await Promise.all([
        !isNew? primaryDal.get<LicenseAppPiiStorage>(originalKey) : Promise.resolve(),
        !isNew? dataDal.get<LicenseAppConfigStorage>(originalKey) : Promise.resolve()
    ]);

    let updated = false;
    let updatedPii = false;
    let originalDeviceId: string;
    if(source.reassign && devicePiiStorage && deviceConfigStorage) {
        originalDeviceId = source.deviceId;
        const deviceId = `MLC-${uuid()}`;
        const key = getAppGlobalV2Key(source.license, deviceId);
        devicePiiStorage.deviceId = deviceId;
        devicePiiStorage.pk = key.pk;
        devicePiiStorage.sk = key.sk;
        devicePiiStorage.pksk = `${key.pk}#${key.sk}`;
        devicePiiStorage.lsk = `${deviceId}`;

        deviceConfigStorage.deviceId = deviceId;
        deviceConfigStorage.pk = key.pk;
        deviceConfigStorage.sk = key.sk;
        deviceConfigStorage.pksk = `${key.pk}#${key.sk}`;

        source.deviceId = deviceId;

        commands.TransactItems.push({
            Put: {
                TableName: dataDal.tableName,
                Item: deviceConfigStorage
            }
        });
        commands.TransactItems.push({
            Put: {
                TableName: primaryDal.tableName,
                Item: devicePiiStorage
            }
        });
    }

    let deviceConfig = deviceConfigStorage;
    console.debug('deviceConfig', deviceConfig);
    if(!deviceConfig) {
        console.info('Creating new device config');
        deviceConfig = {
            ...originalKey,
            pksk: `${originalKey.pk}#${originalKey.sk}`,
            deviceId: source.deviceId,
            dsk: originalKey.pk,
            license: source.license,
            auth: [uuid()],
            textAlerts: source.textAlerts,
            timezone: source.timezone,
            students: [],
            studentIds: []
        };
        updated = true;
    }

    let devicePii = devicePiiStorage;
    if(!devicePii) {
        console.info('Creating new device pii');
        devicePii = {
            ...originalKey,
            pksk: `${originalKey.pk}#${originalKey.sk}`,
            license: source.license,
            deviceId: source.deviceId,
            deviceName: source.name,
            dsk: 'GD',
            studentContextLookup: [],
            studentIds: source.studentConfigs.map(x => x.studentId),
            tags: source.tags,
            lpk: `${source.license}#AG`,
            lsk: `${source.deviceId}`,
            version: 1
        } as LicenseAppPiiStorage;
        updatedPii = true;
    }

    if(!devicePii || devicePii.deviceName != source.name || !isEqual(source.tags, devicePii.tags)) {
        console.info('Adding pii to transaction');
        devicePii = {
                ...originalKey,
                ...devicePiiStorage,
                license: source.license,
                dsk: 'GD',
                deviceName: source.name,
                deviceId: source.deviceId,
                tags: source.tags
            } as LicenseAppPiiStorage;
        updatedPii = true;
    }

    await Promise.all(source.studentConfigs.map(async conf => {
        let existing: LicenseAppConfigStorageStudent = deviceConfig.students.find(s => s.studentId == conf.studentId);
        // const student = await StudentDal.getStudentConfig(existing?.studentId ?? conf.studentId);

        let existingPii = devicePii?.studentContextLookup?.find(x => x.id == conf.studentId);

        if(existingPii) {
            if(existingPii.name != conf.studentName) {
                existingPii.name = conf.studentName;
                updatedPii = true;
            }
        }
        
        if(existing) {
            const behaviorList = [].concat(conf.behaviors, conf.responses);
            if(!isEqual(behaviorList, existing.behaviors)){
                existing.behaviors = behaviorList;
                updated = true;
            }

            if(!isEqual(conf.services, existing.services)) {
                existing.services = conf.services;
                updated = true;
            }

            console.info('Checking delete status', existing.deleted, 'for incoming', conf.delete);
            if(!existing.deleted && conf.delete) {
                console.warn('Deleting student', conf.studentId, 'from device', source.deviceId, 'by', context.identity.username, 'because it was marked for deletion');
                const dcindex = deviceConfig.students.findIndex(x => x.studentId == existing.studentId);
                if(dcindex >= 0) {
                    console.info('Removing student at ', dcindex);
                    deviceConfig.students.splice(dcindex, 1);
                    console.debug('students', deviceConfig.students);
                    updated = true;
                }

                const piindex = devicePii.studentContextLookup.findIndex(x => x.id == existing.studentId);
                console.debug('piindex', piindex);
                if(piindex >= 0) {
                    console.info('Removing student pii at ', piindex);
                    devicePii.studentContextLookup.splice(piindex, 1);
                    console.debug('studentContextLookup', devicePii.studentContextLookup);
                    updatedPii = true;
                }

                if(deviceConfig.deviceId.startsWith('MLC-') && deviceConfig.students.filter(x => !x.deleted).length == 0) {
                    console.warn('Deleting device', source.deviceId, 'because it has no students');
                    deviceConfig.deleted = existing.deleted;
                }
            }
        } else {
            deviceConfig.students.push({
                studentId: conf.studentId,
                behaviors: conf.behaviors.map(b => ({
                    id: b.id,
                    abc: b.abc,
                    intensity: b.intensity,
                    order: b.order
                })),
                services: conf.services.map(s => ({
                    id: s.id,
                    order: s.order
                }))
            });
            updated = true;
        }

        if(!devicePii.studentContextLookup) {
            devicePii.studentContextLookup = [];
        }
        const esPiiContext = devicePii.studentContextLookup.find(x => x.id == conf.studentId);
        if(esPiiContext && esPiiContext.name == conf.studentName) {
            esPiiContext.name = conf.studentName;
        } else if (!esPiiContext && !conf.delete) {
            devicePii.studentContextLookup.push({
                id: conf.studentId,
                name: conf.studentName,
                groups: conf.groups
            });
            updatedPii = true;
        }
    }));

    if(updated) {
        console.info('Adding config to transaction');

        deviceConfig.studentIds = deviceConfig.students
            .filter(x => !x.deleted)
            .map(x => x.studentId);

        commands.TransactItems.push({
            Put: {
                TableName: dataDal.tableName,
                Item: deviceConfig
            }
        });
    }
    if(updatedPii) {
        console.info('Adding pii to transaction');

        devicePii.studentIds = devicePii.studentContextLookup.map(x => x.id);

        commands.TransactItems.push({
            Put: {
                TableName: primaryDal.tableName,
                Item: devicePii
            }
        });
    }

    if(originalDeviceId) {
        console.info(`Setting deleted flag for ${originalDeviceId}`);
        commands.TransactItems = []
        commands.TransactItems.push({
            Update: {
                TableName: primaryDal.tableName,
                Key: originalKey,
                UpdateExpression: 'SET #deleted = :deleted',
                ExpressionAttributeNames: {
                    '#deleted': 'deleted'
                },
                ExpressionAttributeValues: {
                    ':deleted': {
                        by: context.identity.username,
                        date: new Date().getTime(),
                        client: 'Web'
                    }
                }
            }
        });
        commands.TransactItems.push({
            Update: {
                TableName: dataDal.tableName,
                Key: originalKey,
                UpdateExpression: 'SET #deleted = :deleted',
                ExpressionAttributeNames: {
                    '#deleted': 'deleted'
                },
                ExpressionAttributeValues: {
                    ':deleted': {
                        by: context.identity.username,
                        date: new Date().getTime(),
                        client: 'Web'
                    }
                }
            }
        });
    }

    console.debug('commands', commands);
    
    if(commands.TransactItems.length > 0) {
        console.info('Executing transaction');
        await primaryDal.send(new TransactWriteCommand(commands));
    }

    return { deviceId: source.deviceId };
}
