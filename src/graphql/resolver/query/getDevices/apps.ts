import { MttAppSyncContext } from '@mytaptrack/cdk';
import { AppConfigStorage, StudentDal, StudentPii, StudentPiiStorage, WebUtils } from '@mytaptrack/lib';
import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';
import { QLAppSummary } from '@mytaptrack/types';
import { LicenseAppConfigStorage, LicenseAppPiiStorage } from '../../types';
import { response } from '../../mutations/student/service/update-definition/data';

export const handler = WebUtils.lambdaWrapper(handleEvent);

const data = new Dal('data');
const primary = new Dal('primary');

interface AppSyncParams {
    license: string;
    studentId?: string;
}

export async function handleEvent(context: MttAppSyncContext<AppSyncParams, any, any, any>): Promise<QLAppSummary[]> {
    const license = context.arguments.license;
    const studentId = context.arguments.studentId;
    console.info('Getting apps for ', license);
    const studentFilter = studentId? 'and contains(studentIds, :studentId)' : '';
    const [appPiis, appConfs] = await Promise.all([
        primary.query<LicenseAppPiiStorage>({
            keyExpression: 'pk = :license and begins_with(sk, :appPrefix)',
            attributeNames: {
                '#deleted': 'deleted'
            },
            attributeValues: {
                ':license': `L#${license}`,
                ':appPrefix': 'GD#',
                ':studentId': studentId? studentId : undefined
            },
            filterExpression: `attribute_not_exists(#deleted) ${studentFilter}`,
        }),
        studentId? data.query<LicenseAppConfigStorage>({
            keyExpression: 'pk = :license and begins_with(sk, :appPrefix)',
            attributeValues: {
                ':license': `L#${license}`,
                ':appPrefix': 'GD#',
                ':studentId': studentId? studentId : undefined
            },
            attributeNames: {
                '#deleted': 'deleted'
            },
            filterExpression: 'attribute_not_exists(#deleted) and contains(studentIds, :studentId)'
        }): undefined as LicenseAppConfigStorage[]
    ]);

    await Promise.all(appPiis.map(async appPii => {
        if(appPii.studentContextLookup) {
            return;
        }
        appPii.studentContextLookup = [];
        const config = await data.get<LicenseAppConfigStorage>({ pk: appPii.pk, sk: appPii.sk});
        await Promise.all(config.studentIds.map(async sid => {
            const s = await primary.get<StudentPiiStorage>({ pk: `S#${sid}`, sk: 'P'}, 'firstName, lastName');
            appPii.studentContextLookup.push({
                id: sid,
                name: `${s.firstName} ${s.lastName}`,
                groups: []
            });
        }));
    }));
    
    console.info('Pii retrieved', appPiis.length);
    console.debug('appPiis', appPiis);
    const retval = (await Promise.all(appPiis.map(async app => {
        if(app.deleted || (studentId && app.studentContextLookup.find(x => x.id == studentId)?.deleted)) {
            return;
        }
        const appConfig = appConfs?.find(x => x.deviceId == app.deviceId);
        if(appConfig && (
            (studentId && appConfig.students?.find(x => x?.studentId == studentId).deleted) ||
            appConfig.deleted)) {
            return;
        }
        
        const item = {
            deviceId: app.deviceId,
            name: app.deviceName ?? 'Unnamed',
            tags: app.tags?.map(x => x.tag) ?? [],
        } as QLAppSummary;
        if(!appConfig) {
            return item;
        }

        if(studentId) {
            const student = await StudentDal.getStudentBasicPii(studentId);
            const studentPii = app.studentContextLookup?.find(x => x.id == studentId);
            const studentConf = appConfig.students?.find(x => x && x?.studentId == studentId);
            if(!studentConf || !studentPii) {
                return;
            }
            item.groups = studentPii.groups ?? [];
            item.studentId = studentId;
            item.studentName = studentPii.name;
            item.behaviors = studentConf.behaviors.map((behavior, index) => {
                return {
                    id: behavior.id,
                    abc: !behavior.abc? undefined : behavior.abc,
                    intensity: behavior.intensity,
                    order: behavior.order == undefined? index : behavior.order,
                    name: student.behaviorLookup?.find(bl => bl.id == behavior.id)?.name ?? 'Unnamed',
                }
            });
            item.responses = [];
            return item;
        }
        return retval;
    }))).filter(x => (x?.deviceId)? true : false).map(x => x!);

    console.info('Results constructed', retval.length);

    retval.sort((a, b) => a.name.localeCompare(b.name));

    return retval;
}
