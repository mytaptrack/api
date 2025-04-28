import { MttAppSyncContext } from '@mytaptrack/cdk';
import { DeviceDal, StudentConfigStorage, StudentPiiStorage, WebUtils, getStudentPrimaryKey } from '@mytaptrack/lib';
import { Dal, DalKey } from '@mytaptrack/lib/dist/v2/dals/dal';
import { QLApp, GraphQLAppStudent, GraphQLDeviceCollection, GraphQLIoTClicker, GraphQLAppServiceItem } from '@mytaptrack/types';
import { LicenseAppConfigStorage, LicenseAppPiiStorage } from '../../types';

export const handler = WebUtils.lambdaWrapper(handleEvent);

const data = new Dal('data');
const primary = new Dal('primary');

interface AppSyncParams {
    studentId: string;
}

export async function handleEvent(context: MttAppSyncContext<AppSyncParams, any, any, any>): Promise<GraphQLDeviceCollection> {
    const student = await data.get<StudentConfigStorage>(getStudentPrimaryKey(context.arguments.studentId));
    const [appConfigs, devices] = await Promise.all([
        data.query<LicenseAppConfigStorage>({
            keyExpression: 'pk = :license',
            attributeValues: {
                ':license': student.license
            }
        }),
        DeviceDal.getStudentDevices(context.arguments.studentId)
    ]);

    const appKeys = appConfigs.map(a => ({ pk: a.pk, sk: a.sk } as DalKey));
    const studentIds: string[] = [];
    appConfigs.map(a => a.studentIds).forEach(sids => {
        sids.forEach(id => {
            if(!studentIds.find(x => x == id)) {
                studentIds.push(id);
            }
        });
    });
    
    const [appPiis, studentPiis] = await Promise.all([
        primary.batchGet<LicenseAppPiiStorage>(appKeys),
        primary.batchGet<StudentPiiStorage>(studentIds.map(sid => getStudentPrimaryKey(sid)))
    ]);

    return {
        apps: appConfigs.map(app => {
            const pii = appPiis.find(p => p.sk == app.sk);
            const sConf = app.students.find(s => s.studentId == student.studentId);
            if(!pii || !sConf) {
                return;
            }
            
            return {
                deviceId: app.deviceId,
                license: app.license,
                name: pii.deviceName,
                textAlerts: app.textAlerts,
                timezone: app.timezone,
                deleted: app.deleted,
                studentConfigs: app.students.map(sApp => {
                    let appPii = pii.studentContextLookup.find(sc => sc.id == sApp.studentId);
                    const stud = studentPiis.find(s => s.studentId == sApp.studentId);
                    if(!appPii) {
                        appPii = {
                            id: sApp.studentId,
                            name: `${stud.firstName} ${stud.lastName}`,
                            groups: []
                        };
                        pii.studentContextLookup.push(appPii);
                    }
                    return {
                        studentId: sApp.studentId,
                        studentName: appPii?.name ?? stud?.nickname ?? `${stud?.firstName} ${stud?.lastName}`,
                        restrictions: undefined,
                        behaviors: sApp.behaviors.map(b => {
                            return {
                                id: b.id,
                                name: stud?.behaviorLookup?.find(x => x.id == b.id)?.name ?? '',
                                abc: b.abc,
                                intensity: b.intensity,
                                order: b.order
                            }
                        }).sort((a, b) => a.order - b.order),
                        responses: [],
                        services: sApp.services.map(s => {
                            return {
                                id: s.id,
                                name: stud?.servicesLookup?.find(x => x.id == s.id)?.name ?? '',
                                order: s.order
                            } as GraphQLAppServiceItem;
                        }).sort((a, b) => a.order - b.order),
                        groups: []
                    } as GraphQLAppStudent;
                }),
                students: [],
                qrExpiration: app.qrExpiration,
                tags: pii.tags
            } as QLApp;
        }).filter(x => x? true : false).map(x => x!),
        clickers: devices.map(clicker => {
            return {
                dsn: clicker.dsn,
                deviceName: clicker.deviceName,
                validated: clicker.validated,
                events: clicker.events.map(e => {
                    return {
                        behaviorId: e.eventId,
                        presses: e.presses
                    }
                }),
                termSetup: clicker.termSetup,
                commands: clicker.commands,
                timezone: clicker.timezone
            } as GraphQLIoTClicker;
        })
    }
}