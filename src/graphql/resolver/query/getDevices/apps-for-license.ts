import { MttAppSyncContext } from '@mytaptrack/cdk';
import { StudentDal, WebUtils } from '@mytaptrack/lib';
import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';
import { GraphQLAppStudent, QLApp, QLAppSummary } from '@mytaptrack/types';
import { LicenseAppConfigStorage, LicenseAppPiiStorage } from '../../types';

export const handler = WebUtils.lambdaWrapper(handleEvent);

const data = new Dal('data');
const primary = new Dal('primary');

interface AppSyncParams {
    license: string;
    studentId?: string;
}

export async function handleEvent(context: MttAppSyncContext<AppSyncParams, any, any, any>): Promise<QLApp[]> {
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
                ':appPrefix': 'GD#'
            },
            filterExpression: `attribute_not_exists(#deleted)`,
        }),
        data.query<LicenseAppConfigStorage>({
            keyExpression: 'pk = :license and begins_with(sk, :appPrefix)',
            attributeValues: {
                ':license': `L#${license}`,
                ':appPrefix': 'GD#'
            },
            attributeNames: {
                '#deleted': 'deleted'
            },
            filterExpression: 'attribute_not_exists(#deleted)'
        })
    ]);

    const studentIds: string[] = [];
    appPiis.forEach(ap => {
        ap.studentIds?.forEach(id => {
            if(studentIds.indexOf(id) < 0) {
                studentIds.push(id);
            }
        });
    });

    const studentPiis = await Promise.all(studentIds.map(id => StudentDal.getStudentFullPii(id)));

    console.info('Pii retrieved', appPiis.length);
    console.debug('appPiis', appPiis);
    const retval = await Promise.all(appPiis.map(async app => {
        if(app.deleted) {
            return;
        }
        const appConfig = appConfs?.find(x => x.deviceId == app.deviceId);
        if(appConfig && appConfig.deleted) {
            return;
        }

        const item = {
            deviceId: app.deviceId,
            name: app.deviceName ?? 'Unnamed',
            license: app.license,
            timezone: app.timezone ?? 'America/Los_Angeles',
            textAlerts: app.textAlerts ?? false,
            tags: app.tags ?? [],
            studentConfigs: appConfig?.students
            .filter(s => s && !s.deleted)
            .map(s => {
                const sPii = app?.studentContextLookup?.find(x => x.id == s.studentId);
                const studentPii = studentPiis.find(x => x?.studentId == s.studentId);
                console.debug('behaviors', s.behaviors);
                console.debug('studentPii', studentPii);
                return {
                    studentId: s.studentId,
                    studentName: sPii?.name ?? 'Name not found',
                    groups: sPii?.groups,
                    behaviors: s.behaviors.map((b, i) => {
                        const behavior = studentPii?.behaviorLookup?.find(bsi => bsi.id == b.id);
                        const retval = {
                            id: b.id,
                            name: behavior?.name ?? 'Name not found',
                            abc: b.abc,
                            intensity: b.intensity,
                            order: b.order ?? i
                        };
                        console.debug('behavior', retval);
                        return retval;
                    }),
                    services: []
                } as GraphQLAppStudent
            }) ?? [],
            students: []
        } as QLApp;
        return item;
    }));
    console.info('Results constructed', retval.length);

    retval.sort((a, b) => a.name.localeCompare(b.name));

    return retval;
}
