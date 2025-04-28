import { 
    WebUtils,StudentPiiStorage, getStudentPrimaryKey, UserStudentTeam, StudentConfigStorage 
} from '@mytaptrack/lib';
import { AccessLevel, QLStudentSummary } from '@mytaptrack/types';
import { MttAppSyncContext } from '@mytaptrack/cdk';
import { Dal, DalKey } from '@mytaptrack/lib/dist/v2/dals/dal';

const dataDal = new Dal('data');
const primaryDal = new Dal('primary');

interface QueryParams {
    params: {
        behavior: boolean;
        service: boolean;
        trackable: boolean;
    }
}

export const handler: any = WebUtils.graphQLWrapper(handleEvent);

export async function handleEvent(event: MttAppSyncContext<QueryParams, never, never, {}>): Promise<QLStudentSummary[]> {
    WebUtils.logObjectDetails(JSON.stringify(event));
    const username = event.identity.username;
    console.log('Query configs');
    const studentConfigs = await dataDal.query<UserStudentTeam>({
        keyExpression: 'pk = :pk and begins_with(sk, :sk)',
        attributeNames: {
            '#removed': 'removed'
        },
        attributeValues: {
            ':pk': `U#${username}`,
            ':sk': 'S#',
        },
        filterExpression: 'attribute_not_exists(#removed)',
        projectionExpression: 'userId, studentId, behaviorTracking, serviceTracking, removed, restrictions'
    });

    if(!studentConfigs || studentConfigs.length == 0) {
        console.log('No configs retrieved for user', username);
        return [];
    }

    console.log('Filtering students from ', studentConfigs.length);
    WebUtils.logObjectDetails(studentConfigs);
    const filteredStudents: UserStudentTeam[] = [];
    studentConfigs.forEach((x) => {
        if(x.behaviorTracking == undefined && x.serviceTracking == undefined) {
            x.behaviorTracking = true;
            x.serviceTracking = false;
        }

        if(event.arguments.params.trackable && x.restrictions.data != AccessLevel.admin) {
            return;
        }
        if(filteredStudents.find(y => y.studentId == x.studentId)) {
            return;
        }

        if(event.arguments.params.behavior && x.behaviorTracking == true) {
            filteredStudents.push(x);
        } else if(event.arguments.params.service && x.serviceTracking == true) {
            filteredStudents.push(x);
        }
    });
    console.log('Filtered students ', filteredStudents.length);
    console.debug('students', filteredStudents);

    const keys: DalKey[] = [];
    filteredStudents.forEach(x => {
        const key = getStudentPrimaryKey(x.studentId);
        if(!keys.find(x => x.pk == key.pk)) {
            keys.push(key);
        }
    });
    const hasBehaviors = event.info.selectionSetList.find(x => x == 'behaviors');
    const behaviorKeys = hasBehaviors? ', behaviorLookup' : ''
    const abcKeys = event.info.selectionSetList.find(x => x == 'abc')? ', abc' : ''

    const [studentPiis, configs] = await Promise.all([
        primaryDal.batchGet<StudentPiiStorage>(keys, `studentId, firstName, lastName, nickname, subtext, schoolStudentId${behaviorKeys}${abcKeys}`),
        hasBehaviors? dataDal.batchGet<StudentConfigStorage>(keys, `studentId, behaviors`) : Promise.resolve([] as StudentConfigStorage[])
    ]);
    console.log('Retrieved pii', studentPiis.length);
    if(keys.length != studentPiis.length) {
        console.log('Missing keys', keys.filter(x => studentPiis.find(y => y.pk == x.pk && y.sk == x.sk)));
    }

    const accessBehaviors = event.stash.permissions?.student?.behaviors;
 
    return filteredStudents.map(conf => {
        console.info("Processing student", conf.studentId);
        const pii = studentPiis.find(piiVal => conf.studentId == piiVal.studentId);
        const sconf = configs.find(sc => conf.studentId == sc.studentId)

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
            behaviors: sconf?.behaviors? sconf.behaviors.filter(scb => !scb.isArchived && (!accessBehaviors || accessBehaviors.find(bid => bid == scb.id))).map(scb => {
                const bpii = pii?.behaviorLookup.find(x => x.id == scb.id);
                return {
                    baseline: scb.baseline == true,
                    daytime: scb.daytime == true,
                    desc: bpii?.desc,
                    id: scb.id,
                    trackAbc: scb.trackAbc,
                    intensity: scb.intensity,
                    isArchived: scb.isArchived,
                    isDuration: scb.isDuration,
                    name: bpii?.name,
                    managed: scb.managed,
                    requireResponse: scb.requireResponse,
                    targets: scb.targets,
                    tags: bpii?.tags
                }
            }) : [],
            abc: pii?.abc,
            lastTracked: pii?.lastTracked ?? pii?.lastUpdatedDate,
            awaitingResponse: false,
            alertCount: 0
        }
    }).sort((a, b) => a.details.nickname.localeCompare(b.details.nickname));
}
