import { util } from '@aws-appsync/utils';
import {
    StudentPiiStorage, StudentConfigStorage, UserStudentTeam, LicenseStorage, StudentDashboardSettingsStorage, WebUtils, TrackableItem, getStudentSchedulePrimaryKey, ScheduleDal, UserDal, UserDataStorage, getUserPrimaryKey, UserPrimaryStorage, getStudentPrimaryKey
} from '@mytaptrack/lib';
import {
    QLUserSummary, AccessLevel, QLLicenseUsersResult, LicenseStudentSummary, QLUserSummaryStudent, UserSummaryStatus
} from '@mytaptrack/types';
import { BatchGetItemResponse, MttAppSyncContext } from '@mytaptrack/cdk';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchGetCommand, BatchGetCommandInput } from '@aws-sdk/lib-dynamodb';
import { Dal, DalKey, MttIndexes } from '@mytaptrack/lib/dist/v2/dals/dal';

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const data = new Dal('data');
const primary = new Dal('primary');

interface QueryParams {
    license: string;
}

export const handler = WebUtils.graphQLWrapper(eventHandler);

export async function eventHandler(context: MttAppSyncContext<QueryParams, any, any, {}>): Promise<QLLicenseUsersResult> {
    console.log('Getting users');
    const team = await data.query<UserStudentTeam>({
        keyExpression: 'lpk = :license',
        filterExpression: 'attribute_not_exists(deleted) and attribute_not_exists(removed)',
        attributeValues: {
            ':license': `${context.arguments.license}#T`
        },
        attributeNames: {
            '#status': 'status'
        },
        indexName: MttIndexes.license,
        projectionExpression: 'userId, studentId, restrictions, #status, serviceTracking, behaviorTracking'
    });

    const userKeys: DalKey[] = [];
    const studentKeys: DalKey[] = [];
    team.forEach(t => {
        const userKey = getUserPrimaryKey(t.userId);
        if(!userKeys.find(x => x.pk == userKey.pk)) {
            userKeys.push(userKey);
        }

        const studentKey = getStudentPrimaryKey(t.studentId);
        if(!studentKeys.find(x => x.pk == studentKey.pk)) {
            studentKeys.push(studentKey);
        }
    });

    const getUsers = context.info.selectionSetList.find(x => x == 'users')? true : false;
    const getStudents = context.info.selectionSetList.find(x => x == 'students')? true : false;
    
    console.info('Getting user and student details', getUsers, getStudents);
    const [userPiis, studentPiis, studentConfigs] = await Promise.all([
        getUsers? primary.batchGet<UserPrimaryStorage>(userKeys, 'userId, details') : Promise.resolve(undefined),
        getStudents? primary.batchGet<StudentPiiStorage>(studentKeys) : Promise.resolve(undefined),
        getStudents? data.batchGet<StudentConfigStorage>(studentKeys) : Promise.resolve(undefined)
    ]);
    
    const mergedUsers: UserPrimaryStorage[] = [];
    userPiis?.forEach(pii => {
        pii.details.email = pii.details.email.toLowerCase();
        const foundUser = mergedUsers.find(x => x.details.email == pii.details.email);
        if(!foundUser) {
            mergedUsers.push(pii);
        } else if (foundUser.userId == foundUser.details.email && pii.userId != foundUser.userId) {
            foundUser.userId = pii.userId;
        }
    });

    const users = mergedUsers?.map(pii => {
        const rt = {
            id: pii.userId,
            firstName: pii.details.firstName,
            lastName: pii.details.lastName,
            email: pii.details.email,
            name: pii.details.name,
            students: team.filter(x => x.userId == pii.userId || x.userId == pii.details.email)
                .map(s => {
                    if(!s.restrictions) {
                        return;
                    }
                    const ss: QLUserSummaryStudent = {
                        studentId: s.studentId,
                        restrictions: s.restrictions,
                        services: s.serviceTracking,
                        behaviors: s.behaviorTracking,
                        teamStatus: s.status ?? UserSummaryStatus.PendingApproval
                    };
                    if(!ss.restrictions.info) {
                        ss.restrictions.info = ss.restrictions.behavior;
                    }
                    if(!ss.restrictions.documents) {
                        ss.restrictions.documents = ss.restrictions.behavior;
                    }
                    if(!ss.restrictions.abc) {
                        ss.restrictions.abc = ss.restrictions.behavior;
                    }
                    
                    if(!ss.restrictions.reports) {
                        ss.restrictions.reports = ss.restrictions.data;
                    }
                    if(!s.behaviorTracking && !s.serviceTracking) {
                        ss.behaviors = true;
                        ss.services = false;
                    }
                    
                    if(!ss.restrictions.service) {
                        ss.restrictions.service = AccessLevel.none;
                    }
                    if(!s.restrictions.serviceData) {
                        s.restrictions.serviceData = AccessLevel.none;
                    }
                    if(!s.restrictions.serviceGoals) {
                        s.restrictions.serviceGoals = AccessLevel.none;
                    }
                    if(!s.restrictions.serviceSchedule) {
                        s.restrictions.serviceSchedule = AccessLevel.none;
                    }
                    return ss
                }).filter(x => x? true : false)
        } as QLUserSummary;

        return rt;
    }).filter(x => x? true : false) ?? [];

    const students = studentPiis?.map(pii => {
        const conf = studentConfigs.find(x => x.studentId == pii.studentId);
        return {
            id: pii.studentId,
            name: pii.nickname ?? `${pii.firstName} ${pii.lastName}`,
            firstName: pii.firstName,
            lastName: pii.lastName,
            schoolId: pii.schoolStudentId,
            licenseDetails: conf.licenseDetails,
            behaviors: pii.behaviorLookup.map(b => ({ id: b.id, name: b.name })),
            services: pii.servicesLookup?.map(s => ({ id: s.id, name: s.name })) ?? []
        } as LicenseStudentSummary;
    }) ?? [];
    
    const retval = {
        users,
        students
    };
    console.debug('retval', retval);
    return retval;
}
