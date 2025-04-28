import { DalKey } from '@mytaptrack/lib/dist/v2/dals/dal';
import { QLApp, GraphQLAppInput, GraphQLAppStudent, QLTag, QLAppStudentSummary } from '@mytaptrack/types';
import { uuid } from 'short-uuid';

export interface LicenseAppConfigStorageBehaviorItem {
    id: string;
    abc?: boolean;
    intensity?: boolean;
    order: number;
}

export interface LicenseAppConfigStorageServiceItem {
    id: string;
    order: number;
}

export interface LicenseAppConfigStorageStudent {
    studentId: string;
    behaviors: LicenseAppConfigStorageBehaviorItem[];
    services: LicenseAppConfigStorageServiceItem[];
    deleted?: {
        by: string;
        date: number;
        client: 'Web' | 'App'
    };
}

export interface LicenseAppConfigStorage extends DalKey {
    pk: string;
    sk: string;
    pksk: string;
    deviceId: string;
    dsk: string;
    license: string;
    auth: string[];
    deleted?: {
        by: string;
        date: number;
        client: 'Web' | 'App'
    };
    textAlerts: boolean;
    timezone: string;
    students: LicenseAppConfigStorageStudent[];
    studentIds: string[];
    qrExpiration?: number;
}

export interface LicenseAppPiiStorage extends DalKey {
    pksk: string;
    lpk: string;
    lsk: string;
    deviceId: string;
    license: string;
    deleted?: {
        by: string;
        date: number;
        client: 'Web' | 'App'
    };
    deviceName: string;
    dsk: string;
    studentContextLookup: {
        id: string;
        name: string;
        groups: string[];
        deleted?: {
            by: string;
            date: number;
            client: 'Web' | 'App'
        };
    }[];
    studentIds: string[];
    tags: QLTag[];
    textAlerts?: boolean;
    timezone?: string;
    qrExpiration?: number;
}

export interface AppConvertOutput { 
    appConfig: LicenseAppConfigStorage, 
    appPii: LicenseAppPiiStorage
}

export function getAppGlobalV2Key(license: string, deviceId: string): DalKey {
    return {
        pk: `L#${license}`,
        sk: `GD#${deviceId}`
    };
}

export function getNoteStorageKey(studentId: string, noteType: 'NB' | 'NS', noteDate: number, noteId: string): DalKey {
    return {
        pk: `S#${studentId}#${noteType}`,
        sk: `${noteDate}#N#${noteId}`,
    }
}


// export function convertFromGraphQlToAppStorage(source: GraphQLAppInput): AppConvertOutput {
//     const deviceId = source.deviceId ?? `MCU#${uuid().toString()}`;
//     const key = getAppGlobalV2Key(source.license, deviceId);
//     const appConfig: LicenseAppConfigStorage = {
//         ...key,
//         pksk: `${key.pk}#${key.sk}`,
//         deviceId,
//         license: source.license,
//         textAlerts: source.textAlerts ?? undefined as any,
//         timezone: source.timezone ?? undefined as any,
//         students: source.studentConfigs?.map(x => ({
//             studentId: x.studentId,
//             behaviors: x.behaviors.map(y => ({ id: y.id, abc: y.abc, order: y.order } as LicenseAppConfigStorageBehaviorItem)),
//             services: x.services.map(y => ({ id: y.id, order: y.order } as LicenseAppConfigStorageServiceItem))
//         })) ?? undefined as any,
//         studentIds: source.studentConfigs?.map(x => x.studentId) ?? undefined as any,
//         qrExpiration: source.qrExpiration
//     };

//     const appPii: LicenseAppPiiStorage = {
//         ...key,
//         pksk: `${key.pk}#${key.sk}`,
//         lpk: source.license,
//         lsk: deviceId,
//         deviceName: source.name ?? undefined as any,
//         deviceId,
//         license: source.license,
//         studentIds: source.studentConfigs?.map(x => x.studentId),
//         studentContextLookup: source.studentConfigs?.map(x => ({
//             id: x.studentId,
//             name: x.studentName,
//             groups: x.groups ?? []
//          })) ?? undefined as any,
//          tags: source.tags ?? undefined as any
//     };

//     return {
//         appConfig,
//         appPii
//     };
// }

// export function convertFromAppStorageToGraphQl(source: AppConvertOutput) : QLApp {
//     return {
//         deviceId: source.appConfig.deviceId,
//         name: source.appPii.deviceName,
//         license: source.appConfig.license,
//         textAlerts: source.appConfig.textAlerts,
//         timezone: source.appConfig.timezone,
//         students: source.appConfig.students.map(conf => {
//             const pii = source.appPii.studentContextLookup.find(x => x.id == conf.studentId );
//             if(!pii) {
//                 return;
//             }

//             return {
//                 studentId: conf.studentId,
//                 behaviors: conf.behaviors,
//                 services: conf.services,
//                 nickname: pii.name,
//                 groups: pii.groups,
//                 responses: 
//             } as QLAppStudentSummary;
//         }).filter(x => x? true : false).map(x => x!),
//         qrExpiration: source.appConfig.qrExpiration
//     };
// }
