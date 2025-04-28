import {
    AppSyncIdentityCognito
} from 'aws-lambda';

import {
    UserStudentTeam, StudentConfigStorage, ServiceStorage,
    StudentPiiStorage, TrackableItem, PiiTrackable, StudentDal,
    WebUtils, WebError, moment, Moment, TeamDal, getUserStudentSummaryKey, StudentPii, ScheduleDal, isEqual, getStudentPrimaryKey, getUserPrimaryKey, getStudentUserDashboardKey, UserDashboardStorage, getLicenseKey, LicenseStorage,
    LicenseDal,
    getStudentSchedulePrimaryKey
} from '@mytaptrack/lib';
import {
    MttAppSyncContext
} from '@mytaptrack/cdk';
import {
    AccessLevel, QLStudent, QLStudentUpdateInput, QLTrackable,
    UserSummaryRestrictions, Student, StudentBehavior, Milestone
} from '@mytaptrack/types';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand, TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { uuid } from 'short-uuid';
import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';
import { processSchedules } from './schedules';

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const primary = new Dal('primary');
const data = new Dal('data');

export interface AppSyncParams {
    student: QLStudentUpdateInput;
    copyStudentId: string;
}
export interface StudentUpdateStash {
    student: QLStudent;
    isNewStudent: boolean;
    config: StudentConfigStorage;
    pii: StudentPiiStorage;
}

export interface StudentRawStorage {
    config: StudentConfigStorage;
    pii: StudentPiiStorage;
}

function cleanObject(obj: any, skipKeys: boolean = false) {
    if(!obj) {
        return;
    }

    if(typeof obj == 'object') {
        Object.keys(obj).forEach(key => {
            if(obj[key] == undefined && !skipKeys) {
                delete obj[key];
            }
            cleanObject(obj[key]);
        });
    }

    return obj;
}

function containsAll<T>(a: T[], b: T[], evalData: (a:T, b:T) => boolean) {
    if(!a && !b) {
        return true;
    }
    if(!a || !b) {
        return false;
    }

    if(a.length != b.length) {
        return false;
    }
    const retval = a.map(itemA => b.find(itemB =>  evalData(itemA, itemB)));

    return retval;
}

export const handler = WebUtils.graphQLWrapper(handleEvent);

export async function handleEvent(context: MttAppSyncContext<AppSyncParams, never, never, {}>): Promise<Student> {
    console.debug('Context', context);
    if (!context.arguments.student.studentId) {
        // TODO: Check student school id to see if that is in the system
        return await createStudent(context);
    }

    console.debug(context.stash.permissions);

    console.info('Processing updating student');
    const student = context.arguments.student;
    const studentId = context.arguments.student.studentId!;
    const userId = context.identity.username;

    console.info('Getting existing student information');
    const [config, pii] = await Promise.all([
        StudentDal.getStudentConfig(context.arguments.student.studentId!),
        StudentDal.getStudentFullPii(context.arguments.student.studentId!)
    ]);

    if(!config || !pii) {
        console.error('Missing key pieces of student');
        throw new WebError('Access Denied', 403);
    }

    if(!config.absences) {
        config.absences = [];
    }

    const restrictions = context.stash.permissions.student;
    if(restrictions.info == undefined) {
        restrictions.info = restrictions.data;
    }

    console.info('Setting up config/pii structure');
    const sourceStudent = {
        config,
        pii
    };

    let updated = false;

    const dataUpdates: StudentConfigStorage = {} as any;
    const primaryUpdates: StudentPiiStorage = {} as any;

    if (restrictions.milestones == AccessLevel.admin && student.milestones) {
        console.info('Processing milestones');
        primaryUpdates.milestones = student.milestones!.map(x => ({
            date: x.date,
            title: x.title,
            description: x.description
        } as Milestone));
        updated = true;
    }

    if(restrictions.abc == AccessLevel.admin && student.abc) {
        console.info('Processing abc');
        if(!student.abc.remove) {
            primaryUpdates.abc = student.abc;
        } else {
            console.info('Removing abc collection');
            primaryUpdates.abc = undefined;
            
            const license = await LicenseDal.get(student.license!);

            if (license.abcCollections) {
                console.info('Evaluating abc collections from license');
                license.abcCollections.sort((a, b) => a.tags.length - b.tags.length);
                console.log('Checking for collection');
                const abc = license.abcCollections.find(x => x.tags.filter(y => !primaryUpdates.tags.find(z => z.tag === y)).length == x.tags.length);
                if (abc) {
                    console.log('Updating student for abc collection', student.studentId, abc.name);
                    primaryUpdates.abc = abc;
                }
            }

        }
        updated = true;
    }

    if (restrictions.info == AccessLevel.admin) {
        console.info('Processing student info updates');
        if (student.schoolStudentId && student.schoolStudentId != sourceStudent.config.studentId) {
            console.info('School id doesn\'t match');
            dataUpdates.schoolStudentId = student.schoolStudentId;
            primaryUpdates.schoolStudentId = student.schoolStudentId;
        }
        if (student.details) {
            console.info('Processing student details');
            if(sourceStudent.pii.firstName != student.details.firstName) {
                primaryUpdates.firstName = student.details.firstName;
                updated = true;
            }
            if(sourceStudent.pii.lastName != student.details.lastName) {
                primaryUpdates.lastName = student.details.lastName;
                updated = true;
            }
            if(sourceStudent.pii.nickname != student.details.nickname) {
                primaryUpdates.nickname = student.details.nickname;
                if(sourceStudent.pii.subtext) {
                    primaryUpdates.subtext = null;
                    await primary.update({
                        key: getStudentPrimaryKey(studentId),
                        updateExpression: 'REMOVE subtext'
                    });
                }
                updated = true;
            }
            if(sourceStudent.pii.schoolStudentId != student.details.schoolId) {
                primaryUpdates.schoolStudentId = student.details.schoolId;
                dataUpdates.schoolStudentId = student.details.schoolId;
                updated = true;
            }
        }
    }
    if (context.identity.groups?.find(g => g.endsWith(student.license))) {
        if (student.licenseDetails) {
            let updatedLicense = false;
            if(sourceStudent.config.licenseDetails.flexible != student.licenseDetails.flexible) {
                sourceStudent.config.licenseDetails.flexible = student.licenseDetails.flexible ?? sourceStudent.config.licenseDetails.flexible;
                updated = true;
                updatedLicense = true;
            }
            if(sourceStudent.config.licenseDetails.fullYear != student.licenseDetails.fullYear) {
                sourceStudent.config.licenseDetails.fullYear = student.licenseDetails.fullYear ?? sourceStudent.config.licenseDetails.fullYear;
                updated = true;
                updatedLicense = true;
            }
            if(sourceStudent.config.licenseDetails.services != student.licenseDetails.services) {
                sourceStudent.config.licenseDetails.services = student.licenseDetails.services ?? sourceStudent.config.licenseDetails.services;
                updated = true;
                updatedLicense = true;
            }

            if(updatedLicense) {
                dataUpdates.licenseDetails = sourceStudent.config.licenseDetails;
            }
        }
    }
    if (restrictions.behavior == AccessLevel.admin) {
        console.log('Processing behaviors');
        if (student.behaviors) {
            console.log('Behaviors supplied in call');
            const results = mergeTrackables(student.behaviors ?? [], sourceStudent.config.behaviors ?? [], sourceStudent.pii.behaviorLookup ?? [], restrictions.behaviors);

            if (results.updated) {
                dataUpdates.behaviors = results.data;
                primaryUpdates.behaviorLookup = results.primary;
                updated = true;
            }
        }

        if (student.responses) {
            console.log('Processing responses');
            const results = mergeTrackables(student.responses ?? [], sourceStudent.config.responses ?? [], sourceStudent.pii.responseLookup ?? [], restrictions.behaviors);
            if (results.updated) {
                console.log('Responses supplied in call');
                dataUpdates.responses = results.data;
                primaryUpdates.responseLookup = results.primary;
                updated = true;
            }
        }
        if(student.dashboard) {
            console.log('Processing dashboard');
            student.dashboard?.behaviors?.forEach(b => {
                if(!b.duration) {
                    b.duration = {};
                }
            });
            if(student.dashboard['user']) {
                const dashboardKey = getStudentUserDashboardKey(studentId, context.identity.username);
                console.info('Saving user dashboard', dashboardKey);
                await data.put({
                    ...dashboardKey,
                    pksk: `${dashboardKey.pk}#${dashboardKey.sk}`,
                    license: config.license,
                    lpk: `${config.license}#S`,
                    lsk: `DA#${student.studentId}`,
                    studentId: student.studentId,
                    tsk: `U#${context.identity.username}`,
                    userId: context.identity.username,
                    usk: `S#${student.studentId}#DA`,
                    version: 1,
                    dashboard: student.dashboard,
                    settings: undefined
                } as UserDashboardStorage);
            } else {
                dataUpdates.dashboard = student.dashboard;
                updated = true;
            }
        }
    }

    if (restrictions.service == AccessLevel.admin && student.services) {
        console.log('Processing services');
        const updates = student.services;
        const idLimits = restrictions.services;
        const sourceQL = sourceStudent.config.services ?? [];
        const source: ServiceStorage[] = sourceQL;
        const sourcePii = sourceStudent.pii.servicesLookup ?? [];
        let servicesUpdated = false;

        updates.forEach(b => {
            if (idLimits &&
                idLimits.length > 0 &&
                !idLimits.find(pb => pb == b.id)) {
                return;
            }
            updated = true;

            if (!b.id) {
                b.id = uuid();
            }

            const existing = source.find(x => x.id == b.id);
            const existingPii = sourcePii.find(x => x.id == b.id);
            let modificationIdList: string[];
            let modificationPiiList: {id: string, name: string}[];
            if(existing && existingPii) {
                modificationPiiList = existingPii.modifications?.filter(x => b.modifications.find(bx => bx == x.name)) ?? [];
            } else {
                modificationPiiList = [];
            }
            const newItems = b.modifications?.filter(bm => !modificationPiiList.find(x => x.name == bm)) ?? [];

            newItems.forEach(x => {
                modificationPiiList.push({
                    id: uuid(),
                    name: x
                });
            });

            modificationIdList = modificationPiiList.map(x => x.id);

            if (!existing) {
                console.log('Adding new service', b.id);
                source.push({
                    id: b.id,
                    startDate: b.startDate,
                    endDate: b.endDate,
                    durationRounding: b.durationRounding!,
                    isDuration: true,
                    target: b.target!,
                    detailedTargets: b.detailedTargets!,
                    modifications: modificationIdList,
                    goals: b.goals,
                    provided: 0,
                    projected: 0,
                    excluded: 0,
                    lastUpdateDate: 0,
                    weeklyServiceSummary: {}
                });
                updated = true;
                servicesUpdated = true;
            } else {
                console.log('Updating existing service', b.id);
                existing.durationRounding = b.durationRounding ?? 0;
                existing.isArchived = b.isArchived;
                existing.startDate = b.startDate;
                existing.endDate = b.endDate;
                existing.target = b.target ?? 0;
                existing.detailedTargets = b.detailedTargets ?? [];
                existing.modifications = modificationIdList;
                existing.goals = b.goals,
                updated = true;
                servicesUpdated = true;
            }

            if (existingPii) {
                console.log('Checking pii updates');
                if (existingPii.name != b.name || 
                    existingPii.desc != b.desc ||
                    !containsAll(existingPii.modifications.map(a => a.name), b.modifications, (a, b) => a == b)) { 
                    console.log('Updating existing pii');
                    existingPii.name = b.name;
                    existingPii.desc = b.desc;
                    existingPii.modifications = modificationPiiList;
                    updated = true;
                    servicesUpdated = true;
                }
            } else {
                console.log('Adding new pii');
                updated = true;
                servicesUpdated = true;
                sourcePii.push({
                    id: b.id,
                    name: b.name,
                    desc: b.desc,
                    modifications: modificationPiiList,
                    tags: []
                });
            }
        });

        if(servicesUpdated) {
            dataUpdates.services = source;
            primaryUpdates.servicesLookup = sourcePii;
        }
    }

    let schedulePromise: Promise<void> = Promise.resolve();
    if(restrictions.schedules == AccessLevel.admin && student.scheduleCategories) {
        schedulePromise = processSchedules(student);
    }

    const key = {
        pk: `S#${student.studentId}`,
        sk: `P`
    };

    const hasPrimaryUpdates = Object.keys(primaryUpdates).length > 0;
    const hasDataUpdates = Object.keys(dataUpdates).length > 0 

    if(hasPrimaryUpdates || hasDataUpdates) {
        console.log('Updating tables');
        const dataUpdateItem = getTransactionUpdate(cleanObject(dataUpdates), process.env.DataTable!, key);
        console.log(JSON.stringify(dataUpdateItem));
        const piiUpdateItem = getTransactionUpdate(cleanObject(primaryUpdates, true), process.env.PrimaryTable!, key);
        console.log(JSON.stringify(piiUpdateItem));
        await dynamodb.send(new TransactWriteCommand({
            TransactItems: [
                hasDataUpdates? {
                    Update: dataUpdateItem
                } : undefined,
                hasPrimaryUpdates? {
                    Update: piiUpdateItem
                } : undefined
            ].filter(x => x? true : false).map(x => x!)
        }));
    }
    console.log('Returning student');
    await schedulePromise;
    return mapConfigAndPiiToStudent(sourceStudent.config, sourceStudent.pii, restrictions);
    
}

async function createStudent(context: MttAppSyncContext<AppSyncParams, never, never, {}>): Promise<Student> {
    console.log('Processing create student');
    const student = context.arguments.student;

    student.studentId = uuid();
    const studentId = student.studentId;
    const userId = context.identity.username;

    console.log('Processing licenses');
    const licenseGroup = (context.identity as AppSyncIdentityCognito)
        .groups?.find(group => group.endsWith(student.license) || group.endsWith('sys-admin'));
    if (!licenseGroup) {
        console.log('Could not find license access');
        throw new WebError("Access denied", 403);
    }

    const date: Moment = moment();

    console.log('Constructing config storage');
    const dataItem: StudentConfigStorage = {
        pk: `S#${student.studentId}`,
        sk: `P`,
        pksk: `S#${student.studentId}#P`,
        studentId: student.studentId,
        schoolStudentId: student.details.schoolId ?? '',
        behaviors: [],
        responses: [],
        services: [],
        documents: [],
        lastUpdatedDate: date.toISOString(),
        lastActive: date.toISOString(),
        lastTracked: date.toISOString(),
        license: student.license,
        licenseDetails: {
            fullYear: student.licenseDetails!.fullYear ?? false,
            flexible: student.licenseDetails!.flexible ?? false,
            services: student.licenseDetails!.services ?? false
        },
        tsk: `S#${student.studentId}`,
        absences: [],
        lpk: `L#${student.license}`,
        lsk: `S#${student.studentId}`,
        version: 4
    };

    if (!student.licenseDetails!.flexible && !student.licenseDetails!.fullYear &&
        !student.licenseDetails!.services) {
        throw new WebError('No license set for new student', 400);
    }

    console.log('Constructing pii storage');
    const piiStorage: StudentPiiStorage = {
        pk: dataItem.pk,
        sk: dataItem.sk,
        pksk: `S#${dataItem.pk}#${dataItem.sk}`,
        studentId: dataItem.studentId!,
        schoolStudentId: student.details.schoolId ?? '',
        firstName: student.details!.firstName ?? '',
        lastName: student.details!.lastName ?? '',
        nickname: student.details!.nickname ?? `${student.details!.firstName} ${student.details!.lastName}`,
        behaviorLookup: [],
        responseLookup: [],
        servicesLookup: [],
        milestones: [],
        abc: student.abc,
        tags: student.details!.tags?.map((t, i) => ({ tag: t.tag!, type: t.type ?? 'user', order: i })) ?? [],
        lastTracked: date.toISOString(),
        lastUpdatedDate: date.toISOString(),
        tsk: dataItem.tsk,
        lpk: dataItem.lpk,
        lsk: dataItem.lsk,
        license: dataItem.license,
        version: 2
    };

    const restrictions: UserSummaryRestrictions = {
        info: AccessLevel.admin,
        data: AccessLevel.admin,
        schedules: AccessLevel.admin,
        devices: AccessLevel.admin,
        team: AccessLevel.admin,
        comments: AccessLevel.admin,
        behavior: AccessLevel.admin,
        abc: AccessLevel.admin,
        milestones: AccessLevel.admin,
        reports: AccessLevel.admin,
        notifications: AccessLevel.admin,
        documents: AccessLevel.admin,
        service: AccessLevel.admin,
        serviceData: AccessLevel.admin,
        serviceGoals: AccessLevel.admin,
        serviceSchedule: AccessLevel.admin,
    };

    const teamKey = getUserStudentSummaryKey(studentId, userId);
    console.log('Creating new student', studentId);
    const license = context.arguments.student.license ?? context.stash.permissions.license;
    const params: TransactWriteCommandInput = {
        TransactItems: [
            {
                Put: {
                    TableName: process.env.DataTable,
                    Item: dataItem
                }
            },
            {
                Put: {
                    TableName: process.env.PrimaryTable,
                    Item: piiStorage
                }
            },
            {
                Put: {
                    TableName: process.env.DataTable,
                    Item: {
                        pk: teamKey.pk,
                        sk: teamKey.sk,
                        pksk: `${teamKey.pk}#${teamKey.sk}`,
                        tsk: `T#${userId}`,
                        usk: `T#${studentId}`,
                        studentId: studentId,
                        userId: userId,
                        status: 'Verified',
                        behaviorTracking: (student.licenseDetails!.flexible || student.licenseDetails!.fullYear) ? true : false,
                        serviceTracking: context.arguments.student.licenseDetails!.services ? true : false,
                        restrictions,
                        license: context.arguments.student.license,
                        lpk: `${context.arguments.student.license}#T`,
                        lsk: `U#${userId}#S#${studentId}`,
                        version: 1
                    } as UserStudentTeam
                }
            }
        ]
    };

    if(student.licenseDetails.fullYear) {
        const licenseDetails = await data.get<LicenseStorage>(getLicenseKey(student.license));
        if(Array.isArray(licenseDetails.details.singleUsed)) {
            licenseDetails.details.singleUsed = licenseDetails.details.singleUsed.length;
        }
        params.TransactItems.push({
            Update: {
                TableName: data.tableName,
                Key: getLicenseKey(student.license),
                UpdateExpression: 'SET #details.#singleUsed = :addOne',
                ExpressionAttributeNames: {
                    '#details': 'details',
                    '#singleUsed': 'singleUsed'
                },
                ExpressionAttributeValues: {
                    ':addOne': (licenseDetails.details.singleUsed ?? 0) + 1
                }
            }
        });
    }
    await dynamodb.send(new TransactWriteCommand(params));

    return mapConfigAndPiiToStudent(dataItem, piiStorage, restrictions);
}

function updateIfNeeded<T, S>(obj: T, val: S): { updated: boolean, value: S } {
    if ((obj as any) == (val as any)) {
        return { updated: true, value: val };
    }
    return { updated: false, value: val };
}

function mergeTrackables(updates: QLTrackable[], source: TrackableItem[], sourcePii: PiiTrackable[], idLimits: string[] | undefined): { updated: boolean, data: TrackableItem[], primary: PiiTrackable[] } {
    let updated = false;
    updates.forEach(b => {
        if (idLimits &&
            idLimits.length > 0 &&
            !idLimits.find(pb => pb == b.id)) {
            return;
        }

        if (!b.id) {
            console.info('Adding new id to behavior with missing id');
            b.id = uuid();
        }

        const existing = source.find(x => x.id == b.id);

        if (!existing) {
            updated = true;

            source.push({
                id: b.id,
                isArchived: b.isArchived,
                isDuration: b.isDuration,
                trackAbc: b.trackAbc,
                intensity: b.intensity,
                baseline: b.baseline,
                managed: b.managed ?? false,
                daytime: b.daytime ?? false,
                requireResponse: b.requireResponse ?? false,
                targets: b.targets?.map(t => ({
                    targetType: t.targetType!,
                    target: t.target!,
                    progress: t.progress,
                    measurements: t.measurements?.map(m => ({
                        name: m.name!,
                        value: m.value!
                    })) ?? [],
                    measurement: t.measurement as any
                })) ?? []
            });
            sourcePii.push({
                id: b.id,
                name: b.name,
                desc: b.desc,
                tags: []
            });
        } else {
            console.info('Evaluating behavior', b.id, b.trackAbc);
            existing.daytime = b.daytime;
            existing.isArchived = b.isArchived
            existing.isDuration = b.isDuration
            existing.trackAbc = b.trackAbc;
            existing.baseline = b.baseline;
            existing.intensity = b.intensity;
            updated = true;

            b.targets?.forEach(t => {
                const et = existing.targets.find(x => x.targetType == t.targetType);
                if (!et) {
                    existing.targets.push(t as any);
                } else {
                    if (et.progress != t.progress) { et.progress = t.progress; updated = true; }
                    if (et.target != t.target) { et.target = t.target!; updated = true; }
                    if (et.measurements?.length != t.measurements?.length ||
                        et.measurements?.find(x => !t.measurements?.find(i => x.name == i.name && x.value == i.value))) {
                        et.measurements = t.measurements as any;
                        updated = true;
                    }
                    if (et.measurement != t.measurement) { et.measurement = t.measurement as any; updated = true; }
                }
            });
            const targets = updateIfNeeded(existing.targets, b.targets!);
            existing.targets = targets.value.map(v => ({
                targetType: v.targetType!,
                target: v.target!,
                progress: v.progress,
                measurements: v.measurements?.map(m => ({
                    name: m.name!,
                    value: m.value!
                })) ?? [],
                measurement: v.measurement as any
            }));

            const existingPii = sourcePii.find(x => x.id == b.id);
            if (existingPii) {
                if (existingPii.name != b.name) { existingPii.name = b.name; updated = true; }
                if (existingPii.desc != b.desc) { existingPii.desc = b.desc; updated = true; }
            } else {
                updated = true;
                sourcePii.push({
                    id: b.id,
                    name: b.name,
                    desc: b.desc,
                    tags: []
                });
            }

            console.debug(existing);
        }
    });

    return {
        updated,
        data: source,
        primary: sourcePii
    }
}

interface TransactUpdate {
    TableName: string;
    Key: any,
    UpdateExpression: string;
    ExpressionAttributeNames: { [key: string]: string }
    ExpressionAttributeValues: { [key: string]: any }
}

function getTransactionUpdate(updateObj: any, table: string, key: { pk: string, sk: string }): TransactUpdate {
    const setParts: string[] = [];
    const values: { [key: string]: any } = {};
    const names: { [key: string]: string } = {};
    const deleteParts: string[] = [];
    Object.keys(updateObj).forEach(key => {
        if(updateObj[key] != undefined) {
            names[`#${key}`] = key;
            values[`:${key}`] = updateObj[key];
            setParts.push(`#${key} = :${key}`);    
        } else {
            names[`#${key}`] = key;
            deleteParts.push(`#${key}`);
        }
    });

    const deletes = deleteParts.length > 0? `REMOVE ${deleteParts.join(', ')}` : '';
    const sets = setParts.length > 0? `SET ${setParts.join(', ')}` : '';
    let updateExpression = '';
    if(deletes && sets) {
        updateExpression = `${sets} ${deletes}`;
    } else if(sets) {
        updateExpression = sets;
    } else if(deletes) {
        updateExpression = deletes;
    }

    return {
        TableName: table,
        Key: key,
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: Object.keys(values).length > 0? values : undefined
    };
}

function assignValues(dest: any, source: any) {
    if(!dest || !source) {
        return dest;
    }
    Object.keys(source).forEach(key => {
        if(!dest[key] && source[key]) {
            dest[key] = source[key];
        }
    });
    return dest;
}

export function mapConfigAndPiiToStudent(studentConfig: StudentConfigStorage, studentPii: StudentPii, restrictions: UserSummaryRestrictions): Student {
    console.debug('Student Config', studentConfig);
    const originalBehaviors = studentConfig.behaviors ?? [];
    console.debug('originalBehaviors', originalBehaviors);
    const behaviors = originalBehaviors.map(behavior => {
        const pii = studentPii.behaviorLookup.find(b => b.id === behavior.id);
        if (pii) {
            const retval = {
                name: pii.name,
                desc: pii.desc,
                tags: []
            } as StudentBehavior;
            return assignValues(retval, behavior);
        }
        return;
    }).filter(x => x? true : false).map(x => x!);
    console.debug('Constructed behaviors');

    const originalResponses = studentConfig.responses ?? [];
    const responses = originalResponses.map(response => {
        const pii = studentPii.responseLookup.find(b => b.id === response.id);
        if (pii) {
            const retval = {
                name: pii.name,
                desc: pii.desc,
                tags: []
            };

            return assignValues(retval, response);
        }
        return;
    }).filter(x => x? true : false);
    console.debug('Constructed responses');

    const originalServices = studentConfig.services ?? [];
    const services = originalServices.map(service => {
        const pii = studentPii.servicesLookup.find(s => s.id == service.id);
        if(pii) {
            const retval = {
                name: pii.name,
                desc: pii.desc,
                tags: []
            };

            return assignValues(retval, service);
        }
        return;
    }).filter(x => x? true : false).map(x => x!)
    console.debug('Constructed services');

    const retval: Student = {
        studentId: studentConfig.studentId,
        schoolStudentId: studentConfig.schoolStudentId,
        license: studentConfig.license,
        licenseDetails: studentConfig.licenseDetails as any,
        absences: studentConfig.absences,
        details: {
            firstName: studentPii.firstName,
            lastName: studentPii.lastName,
            nickname: studentPii.nickname,
            tags: studentPii.tags
        },
        behaviors,
        responses,
        documents: studentConfig.documents,
        services,
        restrictions,
        milestones: studentPii.milestones,
        abc: studentPii.abc,
        dashboard: studentConfig.dashboard,
        lastTracked: studentConfig.lastTracked,
        lastUpdateDate: studentConfig.lastUpdatedDate,
        archived: studentConfig.archived,
        tags: studentPii.tags.map(x => x.tag),
        partial: false,
        version: 2
    } as Student;

    console.debug('Conversion complete');

    return retval;
}
