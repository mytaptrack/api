import {
    StudentPiiStorage, StudentConfigStorage, UserStudentTeam, LicenseStorage, StudentDashboardSettingsStorage, WebUtils, TrackableItem, TeamDal, AppDal, DeviceDal
} from '@mytaptrack/lib';
import {
    UserSummaryRestrictions, QLStudent, StudentBehavior, BehaviorSettings, DashboardDeviceSettings, StudentDashboardSettings, AccessLevel, UserSummary
} from '@mytaptrack/types';
import { MttAppSyncContext } from '@mytaptrack/cdk';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchGetCommand, BatchGetCommandInput } from '@aws-sdk/lib-dynamodb';
import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';
import { QLDataSources } from '../../../../../../types/src/v2/requests/graphql';
import { LicenseAppPiiStorage, LicenseTrack2PiiStorage } from '../../types';

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const data = new Dal('data');
const primary = new Dal('primary');

interface PreviousResults extends StudentPiiStorage {
    restrictions: any[];
}

export interface StudentUpdateStash {
    student?: QLStudent;
    isNewStudent: boolean;
    config: StudentConfigStorage;
    pii: StudentPiiStorage;
    restrictions: UserSummaryRestrictions;
    studentId: string;
}

interface QueryParams {
    studentId: string;
}


export const handler = WebUtils.graphQLWrapper(eventHandler);

export async function eventHandler(context: MttAppSyncContext<QueryParams, PreviousResults, any, QueryParams>): Promise<QLDataSources> {
    console.log('getStudent data.request');
    const studentId = context.arguments.studentId

    const teamRead = context.stash.permissions.student.team != AccessLevel.none;
    const deviceRead = context.stash.permissions.student.devices != AccessLevel.none
    const [
        team,
        apps,
        track2s
    ] = await Promise.all([
        teamRead? TeamDal.getTeam(studentId) : Promise.resolve([] as UserSummary[]),
        deviceRead? primary.query<LicenseAppPiiStorage>({
            keyExpression: 'pk = :pk',
            filterExpression: 'contains(studentIds, :studentId)',
            attributeValues: {
                ':pk': `AGD#${context.stash.permissions.license}`,
                ':studentId': studentId
            },
            projectionExpression: 'deviceName,deviceId'
        }) : Promise.resolve([] as LicenseAppPiiStorage[]),
        deviceRead? primary.query<LicenseTrack2PiiStorage>({
            keyExpression: 'pk = :pk',
            filterExpression: 'contains(studentIds, :studentId)',
            attributeValues: {
                ':pk': `TRACK2#${context.stash.permissions.license}`,
                ':studentId': studentId
            },
            projectionExpression: 'deviceName,deviceId'
        }) : Promise.resolve([] as LicenseTrack2PiiStorage[])
    ]);

    return {
        team: team.map(x => ({
            id: x.userId,
            name: x.details.name
        })),
        apps: apps.map(x => ({
            id: x.deviceId,
            name: x.deviceName
        })),
        track2: track2s.map(x => ({
            id: x.serialNumber,
            name: x.deviceName
        }))
    };
}
