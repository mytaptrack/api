import { TeamDal, WebUtils,StudentPiiStorage, getStudentPrimaryKey, UserStudentTeam } from '@mytaptrack/lib';
import { QLStudentSummary, StudentSummary } from '@mytaptrack/types';
import { MttAppSyncContext } from '@mytaptrack/cdk';
import { Dal, DalKey } from '@mytaptrack/lib/dist/v2/dals/dal';

const dataDal = new Dal('data');
const primaryDal = new Dal('primary');

interface QueryParams {
    license: string;
    firstName: string;
    lastName: string;
}

export const handler: any = WebUtils.graphQLWrapper(handleEvent);

export async function handleEvent(event: MttAppSyncContext<QueryParams, never, never, never>): Promise<QLStudentSummary[]> {
    console.debug(event);
    const licenseId = event.arguments.license;

    console.info('Query configs');
    const studentConfigs = await dataDal.query<UserStudentTeam>({
        keyExpression: 'lpk = :pk and begins_with(lsk, :sk)',
        attributeValues: {
            ':pk': `${licenseId}#S`,
            ':sk': 'P#',
        },
        filterExpression: 'firstName = :firstName and lastName = :lastName',
        projectionExpression: 'userId, studentId, behaviorTracking, serviceTracking, removed'
    });

    if(!studentConfigs || studentConfigs.length == 0) {
        console.log('No configs retrieved for query');
        return [];
    }

    console.info('Filtering students from ', studentConfigs.length);
    console.debug(studentConfigs);
    
    const keys: DalKey[] = [];
    studentConfigs.forEach(x => {
        const key = getStudentPrimaryKey(x.studentId);
        if(!keys.find(x => x.pk == key.pk)) {
            keys.push(key);
        }
    });

    const studentPiis = await primaryDal.batchGet<StudentPiiStorage>(keys, 'studentId, firstName, lastName, nickname, subtext, schoolStudentId');
    console.log('Retrieved pii', studentPiis.length);
    if(keys.length != studentPiis.length) {
        console.log('Missing keys', keys.filter(x => studentPiis.find(y => y.pk == x.pk && y.sk == x.sk)));
    }
    
    return studentConfigs.map(conf => {
        const pii = studentPiis.find(piiVal => conf.studentId == piiVal.studentId);
        return {
            studentId: conf.studentId,
            details: {
                firstName: pii?.firstName ?? 'No first name',
                lastName: pii?.lastName ?? 'No last name',
                nickname: pii?.nickname ?? pii?.subtext ?? `${pii?.firstName} ${pii?.lastName}` ?? 'No name found',
                schoolId: pii?.schoolStudentId
            },
            tracking: {
                service: conf.serviceTracking? true : false,
                behavior: conf.behaviorTracking || conf.behaviorTracking == undefined? true : false
            },
            lastTracked: pii?.lastTracked ?? pii?.lastUpdatedDate,
            awaitingResponse: false,
            alertCount: 0
        } as QLStudentSummary
    }).sort((a, b) => a.details.nickname.localeCompare(b.details.nickname));
}
