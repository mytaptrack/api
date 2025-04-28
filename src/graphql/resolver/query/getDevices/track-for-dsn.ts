import { MttAppSyncContext } from '@mytaptrack/cdk';
import { 
    DeviceConfigStorage, DevicePiiGlobalStorage,
    LicenseStorage, moment,
    WebError, WebUtils, generateDeviceGlobalKey, generateStudentTrackKey, getLicenseKey, getStudentAppKey, getStudentPrimaryKey, StudentConfigStorage, generateDataKey, DataStorage
} from '@mytaptrack/lib';
import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';
import { IoTDevice } from '@mytaptrack/types';
import { StudentRawStorage } from '../../mutations/student/update-info/data';
import { ReportDataStorage, ReportServiceDataStorage, StudentReportStorage } from '../../types/reports';

export const handler = WebUtils.graphQLWrapper(handleEvent);

const data = new Dal('data');
const primary = new Dal('primary');

interface AppSyncParams {
    dsn: string;
    auth: string;
}

export function getLastTracked(reportData: ReportDataStorage[], behaviorId: string, isDuration: boolean) {
    const trackedArray = isDuration? reportData?.filter(d => d.behavior == behaviorId) ?? [] : [];
    const lastTracked = trackedArray.length > 0? trackedArray[trackedArray.length - 1] : undefined;
    return lastTracked;
}

export function processNotStopped(reportData: ReportDataStorage[], behaviorId: string, isDuration: boolean) {
    const trackedArray = isDuration? reportData?.filter(d => d.behavior == behaviorId) ?? [] : [];
    const lastTracked = trackedArray.length > 0? trackedArray[trackedArray.length - 1] : undefined;
    if(!lastTracked) {
        return false;
    }
    return lastTracked.notStopped? true : false;
}
export function processNotStoppedService(reportData: ReportServiceDataStorage[], behaviorId: string, isDuration: boolean) {
    const trackedArray = isDuration? reportData?.filter(d => d.service == behaviorId) ?? [] : [];
    const lastTracked = trackedArray.length > 0? trackedArray[trackedArray.length - 1] : undefined;
    if(!lastTracked) {
        return false;
    }
    return lastTracked.notStopped? true : false;
}

export async function handleEvent(context: MttAppSyncContext<AppSyncParams, any, any, {}>): Promise<IoTDevice> {
    const dsn = context.arguments.dsn;
    let auth = context.arguments.auth;

    const gkey = generateDeviceGlobalKey(dsn)
    let pii = await primary.get<DevicePiiGlobalStorage>(gkey);
    console.debug('pii', pii);
    if(!pii) {
        console.info('Could not find pii');
        pii = {
            ...gkey,
            pksk: `${gkey.pk}#${gkey.sk}`,
            name: dsn,
            currentStudentId: undefined,
            commands: [],
            lastNotices: { power: undefined },
            license: '',
            identity: {
                current: context.arguments.auth
            },
            deviceId: dsn,
            dsk: 'P',
            validated: true,
            version: 1
        };
        primary.put(pii);
        return {
            dsn,
            studentId: pii.currentStudentId ?? '',
            deviceName: pii.name,
            timezone: '',
            isApp: false,
            multiStudent: true,
            termSetup: pii.termSetup,
            license: '',
            validated: pii.validated,
            deleted: undefined,
            events: [],
            commands: pii.commands
        };
    }
    if(pii.identity.current && pii.identity.current != auth) {
        console.info('Could not authenticate device');
        throw new WebError('No device found');
    }
    if(!pii.currentStudentId) {
        console.info('No current student set for device');
        return {
            dsn,
            studentId: pii.currentStudentId,
            deviceName: pii.name,
            timezone: '',
            isApp: false,
            multiStudent: true,
            termSetup: pii.termSetup,
            license: pii.license ?? '',
            validated: pii.validated,
            deleted: false,
            events: [],
            commands: pii.commands
        };
    }
    console.debug(pii.license);
    const [config, piiLicense, student] = await Promise.all([
        data.get<DeviceConfigStorage>(generateStudentTrackKey(pii.currentStudentId, dsn)),
        data.get<LicenseStorage>(getLicenseKey(pii.license), 'details'),
        data.get<StudentConfigStorage>(getStudentPrimaryKey(pii.currentStudentId)),
    ]);

    console.debug('Student', student);
    console.debug('Config', config);

    let license = piiLicense;
    if(!license) {
        console.info('No license found');
        console.debug('License', student.license);
        license = await data.get<LicenseStorage>(getLicenseKey(student.license), 'details');
    }
    console.debug('License', license);

    if(!config || !student) {
        console.info('No student config found');
        throw new WebError('Student config not found');
    }

    if(moment(license.details.expiration).isBefore(moment())) {
        throw new WebError('License Expired');
    }

    let report: StudentReportStorage;
    if(config.config.behaviors.find(cb => student.behaviors.find(b => b.id == cb.id && b.isDuration))) {
        report = await data.get<StudentReportStorage>(generateDataKey(student.studentId, moment().startOf('week').toDate().getTime()));
    }

    const retval = {
        dsn,
        studentId: pii.currentStudentId,
        deviceName: pii.name,
        timezone: config?.timezone,
        isApp: false,
        multiStudent: true,
        termSetup: pii.termSetup,
        license: license.details.license ?? '',
        validated: pii.validated,
        deleted: config?.deleted,
        events: config?.config.behaviors.map((x, index) => {
            if(!x.id) {
                return {
                    eventId: null
                };
            }
            const isDuration = student.behaviors.find(b => b.id == x.id)?.isDuration;
            const lastTracked = getLastTracked(report?.data, x.id, isDuration);
            return {
                eventId: x.id,
                order: x.order ?? index,
                presses: x.presses,
                isDuration,
                notStopped: lastTracked?.notStopped ?? false,
                lastStart: lastTracked?.notStopped? lastTracked.dateEpoc : undefined
            };
        }).filter(x => x.eventId? true : false),
        commands: pii.commands
    };

    console.debug('retval', retval);
 
    return retval;
}
