import { MttAppSyncContext } from '@mytaptrack/cdk';
import { AppConfigStorage, AppPiiStorage, StudentConfigStorage, StudentPiiStorage, UserStudentTeam, WebUtils, getAppGlobalKey, getStudentAppKey, getStudentPrimaryKey, getUserStudentSummaryKey } from '@mytaptrack/lib';
import { Dal, DalKey, MttIndexes } from '@mytaptrack/lib/dist/v2/dals/dal';
import { AccessLevel, GraphQLAppStudent, QLApp, QLAppStudentSummary, QLAppStudentSummaryTrackable } from '@mytaptrack/types';
import { LicenseAppConfigStorage, LicenseAppPiiStorage, getAppGlobalV2Key } from '../../types';
import { valuesMatch } from '@mytaptrack/types';

export const handler = WebUtils.graphQLWrapper(handleEvent);

const data = new Dal('data');
const primary = new Dal('primary');

interface AppSyncParams {
    license: string;
    deviceId: string;
}

export async function handleEvent(context: MttAppSyncContext<AppSyncParams, any, any, any>): Promise<QLApp> {
    const license = context.arguments.license;
    const deviceId = context.arguments.deviceId;
    console.info('Getting apps for ', license);
    const globalKey = getAppGlobalV2Key(license, deviceId);

    const [devicePii, deviceConfig] = await Promise.all([
        primary.get<LicenseAppPiiStorage>(globalKey),
        data.get<LicenseAppConfigStorage>(globalKey)
    ]);

    console.debug('Pii and student apps retrieved', deviceConfig);

    if(!deviceConfig) {
        return;
    }

    const studentKeys: DalKey[] = [];
    deviceConfig.students.forEach(sac => {
        const key = getStudentPrimaryKey(sac.studentId)
        if(!studentKeys.find(x => x.pk == key.pk)) {
            studentKeys.push(key);
        }
    });

    console.debug('Student Keys', studentKeys);

    const [studentPiis, studentConfigs, userStudentSummaries] = await Promise.all([
        primary.batchGet<StudentPiiStorage>(studentKeys, 'studentId, behaviorLookup, responseLookup, servicesLookup,nickname, firstName, lastName'),
        data.batchGet<StudentConfigStorage>(studentKeys, 'studentId, abc, behaviors, responses, services'),
        data.batchGet<UserStudentTeam>(deviceConfig.students.map(sk => getUserStudentSummaryKey(sk.studentId, context.identity.username)), 'studentId, restrictions'),
    ]);

    console.debug('App Pii', studentPiis);
    console.debug('Student Pii', studentConfigs);
    console.debug('devicePii', devicePii);

    if(!devicePii.studentContextLookup) {
        console.info('Fixing devicePii');
        const studentIds = studentConfigs.map(x => getStudentPrimaryKey(x.studentId));
        const students = await primary.batchGet<StudentPiiStorage>(studentIds, 'studentId, firstName, lastName');
        devicePii.studentContextLookup = students.map(s => ({
            id: s.studentId,
            name: `${s.firstName} ${s.lastName}`,
            groups: [],
        }));
        devicePii.studentIds = studentConfigs.map(x => x.studentId);

        await primary.update({
            key: { pk: devicePii.pk, sk: devicePii.sk },
            updateExpression: 'SET studentContextLookup = :studentContextLookup',
            attributeValues: {
                ':studentContextLookup': devicePii.studentContextLookup
            }
        });
    }

    const retval: QLApp = {
        deviceId: deviceId,
        license: license,
        name: devicePii.deviceName,
        textAlerts: deviceConfig.textAlerts,
        timezone: deviceConfig.timezone,
        studentConfigs: deviceConfig.students.map(sac => {
            const studentAppPii = devicePii?.studentContextLookup?.find(x => x.id == sac.studentId);
            const student = studentConfigs.find(x => x.studentId == sac.studentId);
            const studentPii = studentPiis.find(x => x.studentId == sac.studentId);
            const team = userStudentSummaries.find(x => x.studentId == sac.studentId);
            if(!studentAppPii || !student) {
                return;
            }
            if(!team || team.restrictions.devices == AccessLevel.none) {
                return {
                    studentId: "Restricted",
                    studentName: "Restricted",
                    restrictions: undefined,
                    groups: [],
                    behaviors: [],
                    responses: [],
                    services: []
                };
            }
            return {
                studentId: sac.studentId,
                studentName: studentAppPii.name,
                groups: studentAppPii.groups,
                behaviors: sac.behaviors?.map(sacb => {
                    const behavior = studentPii.behaviorLookup.find(x => x.id == sacb.id);
                    if(!behavior) {
                        return;
                    }
                    let showName = true;
                    if(team.restrictions.behavior == AccessLevel.none || (
                        team.restrictions.behaviors && !team.restrictions.behaviors.find(x => x == sacb.id))) {
                        showName = false;
                    }
                    return {
                        id: sacb.id,
                        track: true,
                        abc: sacb.abc,
                        intensity: sacb.intensity? true : undefined,
                        order: sacb.order,
                        name: showName? behavior.name ?? '' : 'Restricted'
                    };
                }).filter(x => x? true : false) ?? [],
                responses: sac.behaviors.map(sacb => {
                    const response = studentPii.responseLookup.find(x => x.id == sacb.id);
                    if(!response) {
                        return;
                    }
                    let showName = true;
                    if(team.restrictions.behavior == AccessLevel.none || (
                        team.restrictions.behaviors && !team.restrictions.behaviors.find(x => x == sacb.id))) {
                        showName = false;
                    }
                    return {
                        id: sacb.id,
                        track: true,
                        abc: sacb.abc,
                        order: sacb.order,
                        name: showName? response?.name ?? '' : 'Restricted'
                    };
                }).filter(x => x? true : false) ?? [],
                services: sac.services?.map(sacb => {
                    const service = studentPii.servicesLookup.find(x => x.id == sacb.id);
                    const serviceConf = student.services.find(x => x.id == sacb.id);
                    if(!service) {
                        return;
                    }

                    let showName = true;
                    if(team.restrictions.service == AccessLevel.none || (
                        team.restrictions.services && !team.restrictions.services.find(x => x == sacb.id))) {
                        showName = false;
                    }
                    return {
                        id: sacb.id,
                        order: sacb.order,
                        name: showName? service?.name ?? '' : 'Restricted',
                        percentage: serviceConf.goals.trackGoalPercent,
                        trackedItems: serviceConf.goals.goalTargets.map(x => x.name) ?? [],
                        modifications: service.modifications.map(x => x.name ) ?? []
                    };
                }).filter(x => x? true : false) ?? []
            } as GraphQLAppStudent;
        }).filter(sac => { return sac? true : false }),
        students: studentConfigs?.map(studentConfig => {
            const studentPii = studentPiis.find(x => x.studentId == studentConfig.studentId);
            const team = userStudentSummaries.find(x => x.studentId == studentConfig.studentId);
            if(!studentPii || !team) {
                console.debug('Skipping student', studentPii, team);
                return;
            }
            if(!team || team.restrictions.devices == AccessLevel.none) {
                console.debug('Access to student is restricted', studentPii, team);
                return;
            }
            return {
                studentId: studentConfig.studentId,
                nickname: studentPii.nickname ?? `${studentPii.firstName} ${studentPii.lastName}`,
                abcAvailable: studentConfig.abc && studentConfig.abc.antecedents?.length > 0 && studentConfig.abc.consequences?.length > 0,
                restrictions: {
                    info: team.restrictions.info ?? AccessLevel.none,
                    data: team.restrictions.data ?? AccessLevel.none,
                    schedules: team.restrictions.schedules ?? AccessLevel.none,
                    devices: team.restrictions.devices ?? AccessLevel.none,
                    team: team.restrictions.team ?? AccessLevel.none,
                    comments: team.restrictions.comments ?? AccessLevel.none,
                    behavior: team.restrictions.behavior ?? AccessLevel.none,
                    behaviors: team.restrictions.behaviors,
                    abc: team.restrictions.abc ?? AccessLevel.none,
                    service: team.restrictions.service ?? AccessLevel.none,
                    services: team.restrictions.services,
                    milestones: team.restrictions.milestones ?? AccessLevel.none,
                    reports: team.restrictions.reports ?? AccessLevel.none,
                    notifications: team.restrictions.notifications ?? AccessLevel.none,
                    reportsOverride: team.restrictions.reportsOverride,
                    transferLicense: team.restrictions.transferLicense,
                    documents: team.restrictions.documents ?? AccessLevel.none
                },
                behaviors: team.restrictions.behavior == AccessLevel.none? [] : studentConfig.behaviors?.filter(b => !b.isArchived).map(b => {
                    const bPii = studentPii.behaviorLookup.find(x => x.id == b.id);
                    if(!bPii) {
                        return;
                    }
                    if(team.restrictions.behavior == AccessLevel.none || (
                        team.restrictions.behaviors && !team.restrictions.behaviors.find(x => x == b.id))) {
                        return;
                    }
                    return{
                        id: b.id,
                        name: bPii.name,
                        baseline: b.baseline,
                        isDuration: b.isDuration,
                        trackAbc: b.trackAbc
                    } as QLAppStudentSummaryTrackable;
                }).filter(b => b? true : false) ?? [],
                responses: team.restrictions.behavior == AccessLevel.none? [] : studentConfig.responses?.filter(r => !r.isArchived).map(r => {
                    const rPii = studentPii.responseLookup?.find(x => x.id == r.id);
                    if(!rPii) {
                        return;
                    }
                    if(team.restrictions.behavior == AccessLevel.none || (
                        team.restrictions.behaviors && !team.restrictions.behaviors.find(x => x == r.id))) {
                        return;
                    }
                    if(!r.id ) {
                        console.debug('Missing id pii', rPii);
                        return;
                    }
                    return{
                        id: r.id,
                        name: rPii.name,
                        baseline: r.baseline,
                        isDuration: r.isDuration,
                        trackAbc: r.trackAbc
                    } as QLAppStudentSummaryTrackable;
                }).filter(b => b? true : false) ?? [],
                services: team.restrictions.service == AccessLevel.none? [] : studentConfig.services?.filter(s => !s.isArchived).map(s => {
                    const sPii = studentPii.servicesLookup?.find(x => x.id == s.id);
                    if(!sPii) {
                        return;
                    }
                    if(team.restrictions.service == AccessLevel.none || (
                        team.restrictions.services && !team.restrictions.services.find(x => x == s.id))) {
                        return;
                    }
                    return{
                        id: s.id,
                        name: sPii.name,
                        isDuration: true
                    } as QLAppStudentSummaryTrackable;
                }).filter(b => b? true : false) ?? []
            } as QLAppStudentSummary;
        }).filter(s => s? true : false) ?? [],
        qrExpiration: deviceConfig.qrExpiration,
        tags: devicePii.tags ?? []
    }

    retval.studentConfigs.sort((a, b) => a.studentName.localeCompare(b.studentName));
    retval.studentConfigs.forEach(s => {
        s.behaviors.sort((a, b) => a.order - b.order);
        s.responses.sort((a, b) => a.order - b.order);
        s.services.sort((a, b) => a.order - b.order);
    });
    console.debug('retval', retval);

    return retval;
}