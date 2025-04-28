import { util } from '@aws-appsync/utils'
import { type AppSyncIdentityCognito } from 'aws-lambda';
import { type UserStudentTeam } from '@mytaptrack/lib';
import { type MttAppSyncContext, DdbAndRequirements } from '@mytaptrack/cdk';
import { UserSummaryRestrictions } from '@mytaptrack/types';

interface AppSyncParams {
  studentId: string;
  student?: {
    studentId: string;
  }
}

/**
 * Request a single item with `id` from the attached DynamoDB table datasource
 * @param event the context object holds contextual information about the function invocation.
 */
export function request(event: MttAppSyncContext<AppSyncParams, { payload: DdbAndRequirements }, any, { username: string }>) {
  console.log('authorization check_access.request', event);
  const username = (event.identity as AppSyncIdentityCognito).username
  event.stash.username = username;
  const studentId = event.arguments.studentId ?? event.arguments.student?.studentId;

  if(!username) {
    if(event.stash.system.auth) {
      event.stash.system.auth.service = 'system';
    } else {
      event.stash.system.auth = {
        service: 'system',
        student: {}
      };
    }
  }

  return { 
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({ 
      pk: `U#${username}`, 
      sk: `S#${studentId}#S`
    }),
    projection: {
      expression: 'studentId,restrictions,removed,license'
    }
  }
}

/**
 * Returns the result directly
 * @param event the context object holds contextual information about the function invocation.
 */
export function response(event: MttAppSyncContext<AppSyncParams, UserStudentTeam, UserStudentTeam, { }>) {
  console.log('authorization check_access.response');

  if(!event.arguments.studentId && !event.arguments.student?.studentId) {
    return {
      studentId: undefined,
      restrictions: undefined
    };
  }

  if(event.stash.system.auth?.service == 'system') {
    return {
      studentId: event.arguments.studentId,
      restrictions: {
        data: 'Admin',
        schedules: 'Admin',
        devices: 'Admin',
        team: 'Admin',
        comments: 'Admin',
        behavior: 'Admin',
        abc: 'Admin',
        milestones: 'Admin',
        reports: 'Admin',
        notifications: 'Admin',
        documents: 'Admin'
       }
    } as UserStudentTeam;
  }

  const teamData: UserStudentTeam = event.result;
  if(!teamData || teamData.removed) {
    util.error("Access denied", "Unauthorized");
    return;
  }

  let authenticationInfo: DdbAndRequirements = event.stash.system;

  if(authenticationInfo?.auth && authenticationInfo.auth.student) {
    Object.keys(authenticationInfo.auth.student).forEach(key => {
      if(authenticationInfo.auth[key] == 'Admin' && teamData.restrictions[key] != 'Admin') {
        util.error("Access denied", "Unauthorized");
        return;
      }
      if(authenticationInfo[key] == 'Read Only' && (teamData.restrictions[key] != 'Admin' && teamData.restrictions[key] != 'Read Only')) {
        util.error("Access denied", "Unauthorized");
        return;
      }
    });
  }

  if(teamData.restrictions.info == undefined) {
    teamData.restrictions.info = teamData.restrictions.data;
  }

  if(!teamData.restrictions.service) {
    teamData.restrictions.service = 'No Access' as any;
  }

  event.stash.permissions = {
    student: teamData.restrictions,
    serviceTracking: teamData.serviceTracking,
    behaviorTracking: teamData.behaviorTracking,
    license: teamData.license
  };
  return event.result;
}
