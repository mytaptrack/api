import {
    StudentConfigStorage,
    StudentPiiStorage,
    UserPrimaryStorage,
    UserTeamInviteStorage,
    WebUtils, getStudentPrimaryKey, getUserPrimaryKey, getUserStudentSummaryKey, moment
} from '@mytaptrack/lib';
import {
    MttAppSyncContext
} from '@mytaptrack/cdk';
import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';
import { AccessLevel, QLStudentSummary, UserSummaryStatus } from '@mytaptrack/types';

const dataDal = new Dal('data');
const primaryDal = new Dal('primary');

interface Params {
    studentId: string;
    status: UserSummaryStatus;
}

export const handler = WebUtils.lambdaWrapper(handleEvent);

export async function handleEvent(context: MttAppSyncContext<Params, never, never, {}>): Promise<QLStudentSummary> {
    console.log('Processing updating app');
    const userId = context.identity.username;
    const studentId = context.arguments.studentId;

    const user = await primaryDal.get<UserPrimaryStorage>(getUserPrimaryKey(userId));

    const userTeamKey = getUserStudentSummaryKey(context.arguments.studentId, userId);
    const emailTeamKey = getUserStudentSummaryKey(context.arguments.studentId, user.details.email);
    const [studentInvite, emailInvite] = await Promise.all([
        dataDal.get<UserTeamInviteStorage>(userTeamKey),
        dataDal.get<UserTeamInviteStorage>(emailTeamKey)
    ]);

    if(studentInvite) {
        if(studentInvite.status == UserSummaryStatus.RemovalPending) {
            throw new Error('Student invite not found');
        }

        console.info('Updating user student invite');
        await dataDal.update({
            key: userTeamKey,
            updateExpression: 'SET #status = :status',
            attributeNames: {
                '#status': 'status'
            },
            attributeValues: {
                ':status': context.arguments.status
            }
        });
    } 
    if(emailInvite) {
        if(emailInvite.status == UserSummaryStatus.RemovalPending) {
            throw new Error('Student invite not found');
        }

        console.log('Handling email invite');
        await dataDal.put({
            ...emailInvite,
            ...userTeamKey,
            pksk: `${userTeamKey.pk}#${userTeamKey.sk}`,
            userId: userId,
            status: context.arguments.status
        });

        console.log('Removing invite');
        await dataDal.delete(emailTeamKey);
    } 
    
    if(!emailInvite && !studentInvite) {
        throw new Error('Student invite not found');
    }

    const pii = await primaryDal.get<StudentPiiStorage>(getStudentPrimaryKey(studentId));

    return {
        studentId: studentId,
        details: {
            firstName: pii.firstName,
            lastName: pii.lastName,
            nickname: pii.nickname,
            schoolId: pii.schoolStudentId
        },
        tracking: {
            service: (studentInvite ?? emailInvite).restrictions.service != AccessLevel.none,
            behavior: (studentInvite ?? emailInvite).restrictions.behavior != AccessLevel.none,
        },
        lastTracked: '',
        awaitingResponse: false,
        alertCount: 0
    };
}
