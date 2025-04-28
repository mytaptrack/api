import { util } from '@aws-appsync/utils';
import {
    StudentPiiStorage, StudentConfigStorage, StudentDashboardSettingsStorage, WebUtils, 
    TrackableItem, getStudentSchedulePrimaryKey, ScheduleDal, LicenseDal, getStudentPrimaryKey, 
    WebError, getStudentUserDashboardKey, UserDal
} from '@mytaptrack/lib';
import {
    UserSummaryRestrictions, QLStudent, StudentBehavior, BehaviorSettings, DashboardDeviceSettings, 
    StudentDashboardSettings, ScheduleCategory, NotificationDetails, Notification, NotificationType, NotificationDetailsBehavior, AccessLevel, QLService, LicenseFeatures,
} from '@mytaptrack/types';
import { BatchGetItemResponse, MttAppSyncContext } from '@mytaptrack/cdk';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchGetCommand, BatchGetCommandInput } from '@aws-sdk/lib-dynamodb';
import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';

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

interface DBQueryResult {
    data: {
        [key: string]: any[];
    };
}

interface QueryParams {
    studentId: string;
    userId?: string;
    license: string;
}

function hasAccess(restriction: AccessLevel): boolean {
    return restriction == AccessLevel.read || restriction == AccessLevel.admin;
}

export const colors = [
    ['#C94CE0', '#CA72F5', '#B287DE', '#D5C2FF', '#9183EB'],
    ['#437AE0', '#69B1F5', '#83C1DE', '#BDF5FF', '#7FEBE9'],
    ['#51E099', '#78F5A1', '#87DE94', '#C4FFC2', '#9DEB83'],
    ['#E0D24C', '#F5DF73', '#DECA87', '#FFEDC2', '#FFE9C2'],
    ['#E0632D', '#F57451', '#DE8578', '#FFB3B0', '#FFB4C5'],
    ['#E38134', '#F7904D', '#E0956E', '#BF8F7A', '#FFC7B3'],
    ['#9152DE', '#A06DF2', '#926FDE', '#AF94FF', '#C3B5FF'],
    ['#60E0DE', '#89F5DF', '#85DEBC', '#BFFFDB', '#CFFFDB'],
    ['#76E041', '#B9F567', '#CDDE81', '#FFFEBA', '#FFFAC9'],
    ['#BDB411', '#D9CD30', '#F0E35B', '#EDE27E', '#FFF5AB'],
];
export const colors_light = ['#C2C2FF', '#FFC2C2', '#C2FFC2', '#777', '#33ffff', '#ff66ff', '#ffb266', '#9933ff'];

function checkOptional(val: boolean | undefined): boolean {
    return val ? true : false;
}

function assignValues(dest: any, source: any): any {
    if (!source) {
        return dest;
    }

    Object.keys(source).forEach(key => {
        if (!dest[key]) {
            dest[key] = source[key];
        }
    });

    return dest;
}

export const handler = WebUtils.graphQLWrapper(eventHandler);

export async function eventHandler(context: MttAppSyncContext<QueryParams, PreviousResults, any, QueryParams>): Promise<QLStudent | null> {
    console.log('getStudent data.request');
    const studentId = context.arguments.studentId

    console.info('Student id', studentId);

    let userId = context.identity.username;
    if(context.identity['accountId'] && context.identity['cognitoIdentityAuthProvider'] == null) {
        userId = context.arguments.userId
    }

    const scheduleKey = getStudentSchedulePrimaryKey(studentId, ' ', 0);
    const studentKey = getStudentPrimaryKey(studentId);
    const dashboardKey = getStudentUserDashboardKey(studentId, userId);

    const [studentConfig, studentPii, userDashboard, schedules, notifications] = await Promise.all([
        data.get<StudentConfigStorage>(studentKey),
        primary.get<StudentPiiStorage>(studentKey),
        data.get<StudentDashboardSettingsStorage>(dashboardKey),
        ScheduleDal.getSchedules(studentId, 0),
        context.info.selectionSetList?.find(x => x == 'notifications')? UserDal.getStudentBehaviorNotifications(userId, studentId) : Promise.resolve(undefined)
    ]);

    if(!studentConfig) {
        throw new WebError('Access Denied');
    }

    console.log('Getting license data', studentConfig.license);
    const licenseConfig = await LicenseDal.get(studentConfig.license ?? studentPii.license ?? context.stash.license);
    
    const restrictions = context.stash.permissions.student;
    if(restrictions) {
        if(!restrictions.abc) {
            restrictions.abc = restrictions.behavior;
        }
    }

    console.log('Mapping config and pii for student');
    const retval: QLStudent = mapConfigAndPiiToStudent(studentConfig, studentPii, context.stash.permissions.student, userDashboard, schedules, notifications);
    retval.restrictions = restrictions;

    const features = licenseConfig?.features! ?? ({
        abc: false,
        snapshot: false,
        dashboard: false,
        browserTracking: false,
        download: false,
        duration: false,
        manage: false,
        supportChanges: false,
        schedule: false,
        devices: false,
        behaviorTargets: false,
        response: false,
        emailTextNotifications: false,
        manageStudentTemplates: false,
        manageResponses: false,
        notifications: false,
        appGroups: false,
        documents: false,
        intervalWBaseline: false,
        behaviorTracking: false,
        serviceTracking: false,
        serviceProgress: false,
        displayTags: [] as any
    } as LicenseFeatures);

    console.log('Mapping features');
    retval.features = {
        abc:  checkOptional(features.abc),
        snapshot: checkOptional(features.snapshot),
        snapshotConfig: features.snapshotConfig,
        dashboard: features.dashboard,
        browserTracking: features.browserTracking,
        duration: features.duration || features.duration == undefined,
        download: features.download,
        manage: features.manage,
        supportChanges: features.supportChanges,
        schedule: features.schedule,
        devices: features.devices,
        behaviorTargets: features.behaviorTargets,
        response: features.response,
        emailTextNotifications: features.emailTextNotifications,
        manageStudentTemplates: features.manageStudentTemplates,
        manageResponses: features.manageResponses,
        notifications: checkOptional(features.notifications),
        appGroups: checkOptional(features.appGroups),
        documents: checkOptional(features.documents),
        intervalWBaseline: checkOptional(features.intervalWBaseline),
        personal: features.personal ?? undefined,
        displayTags: features.displayTags ?? [],
        intensity: features.intensity
    };

    if(!retval.license) {
        retval.license = '';
        retval.licenseDetails = {
            services: false,
            transferable: false
        };
    }

    console.log('Returning result');
    return retval;
}

export function mapConfigAndPiiToStudent(studentConfig: StudentConfigStorage, studentPii: StudentPiiStorage, restrictions: UserSummaryRestrictions, userDashboard?: StudentDashboardSettingsStorage, schedules?: ScheduleCategory[], notifications?: Notification<NotificationDetails>[]): QLStudent {
    if (!studentPii.servicesLookup) {
        studentPii.servicesLookup = [];
    }
    if (!studentConfig.services) {
        studentConfig.services = [];
    }
    
    console.debug('Student Config', studentConfig);
    const originalBehaviors = studentConfig.behaviors ?? [];
    console.debug('originalBehaviors', originalBehaviors);
    const behaviors = originalBehaviors.map(behavior => {
        if(restrictions.behavior != AccessLevel.read && restrictions.behavior != AccessLevel.admin) {
            return;
        }
        if(restrictions.behaviors && !restrictions.behaviors.find(x => x == behavior.id)) {
            return;
        }
        const pii = studentPii.behaviorLookup.find(b => b.id === behavior.id);
        if (!pii) {
            return;
        }
        const retval = {
            name: pii.name,
            desc: pii.desc,
            tags: []
        } as StudentBehavior;
        return assignValues(retval, behavior);
    }).filter(x => x? true : false).map(x => x!);
    console.debug('Constructed behaviors');

    const originalResponses = studentConfig.responses ?? [];
    const responses = originalResponses?.map(response => {
        if(restrictions.behavior != AccessLevel.read && restrictions.behavior != AccessLevel.admin) {
            return;
        }
        if(restrictions.behaviors && !restrictions.behaviors.find(x => x == response.id)) {
            return;
        }
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
    }).filter(x => x? true : false) ?? [];
    console.debug('Constructed responses');

    const originalServices = studentConfig.services ?? [];
    const services = originalServices?.map(service => {
        if(restrictions.service != AccessLevel.read && restrictions.service != AccessLevel.admin) {
            return;
        }
        if(restrictions.services && !restrictions.services.find(x => x == service.id)) {
            return;
        }
        const pii = studentPii.servicesLookup.find(s => s.id == service.id);
        if(pii) {
            const retval: QLService = {
                name: pii.name,
                desc: pii.desc
            } as any;

            assignValues(retval, service);

            retval.modifications = pii.modifications?.map(x => x.name) ?? [];
            return retval;
        }
        return;
    }).filter(x => x? true : false).map(x => x!) ?? [];
    console.debug('Constructed services');

    console.log('Getting dashboard settings');
    const studentDashboard = getDashboardSettings(studentConfig);
    WebUtils.logObjectDetails(studentDashboard);

    const dashboard = updateDashboardSettings(userDashboard?.dashboard, studentConfig) ?? updateDashboardSettings(studentDashboard, studentConfig);
    console.debug('Dashboard', dashboard);

    console.log('Constructing QLStudent');
    const retval = {
        studentId: studentConfig.studentId,
        schoolStudentId: studentConfig.schoolStudentId,
        license: studentConfig.license,
        licenseDetails: studentConfig.licenseDetails as any,
        absences: studentConfig.absences ?? [],
        details: hasAccess(restrictions.info)? {
            firstName: studentPii.firstName,
            lastName: studentPii.lastName,
            nickname: studentPii.nickname ?? studentPii.subtext,
            schoolId: studentPii.schoolStudentId,
            tags: studentPii.tags
        } : { firstName: 'No name', lastName: 'access', nickname: 'No name access', tags: []},
        behaviors,
        responses,
        documents: hasAccess(restrictions.documents)? studentConfig.documents : [],
        services,
        restrictions,
        milestones: hasAccess(restrictions.milestones)? studentPii.milestones : [],
        abc: hasAccess(restrictions.abc)? studentPii.abc : undefined,
        dashboard,
        studentDashboard: studentConfig.dashboard,
        lastTracked: hasAccess(restrictions.data)? studentConfig.lastTracked : 0,
        lastUpdateDate: hasAccess(restrictions.info)? studentConfig.lastUpdatedDate : 0,
        archived: studentConfig.archived,
        tags: hasAccess(restrictions.info)? studentPii.tags.map(x => x.tag) : [],
        partial: false,
        features: undefined as any, // This gets filled in later,
        scheduleCategories: hasAccess(restrictions.schedules)? schedules :  [],
        notifications: notifications?.filter(n => n.details.type == NotificationType.Behavior).map((n: Notification<NotificationDetailsBehavior>) => {
            const retval = {
                epoch: n.date,
                behaviorId: n.details.behaviorId
            };
            if(!retval.behaviorId || retval.epoch == undefined) {
                return;
            }
            return retval;
        }).filter(x => x? true : false) ?? undefined,
        version: 2
    } as QLStudent;

    console.log('Mapping complete, returning result');
    console.debug(retval);

    return retval;
}

function evalDurationColorMapping(item: TrackableItem, setting: BehaviorSettings, index: number, isNew: boolean = false) {
    if (item.isDuration) {
        if (item.targets) {
            if (setting.duration) {
                console.log('Duration map found, checking for boolean values');
                Object.keys(setting.duration).forEach((key, i) => {
                    if (typeof setting.duration![key] == 'boolean') {
                        if(setting.duration![key] == true) {
                            setting.duration![key] = colors[index % colors.length][i];
                        } else {
                            delete setting.duration![key];
                        }
                    }
                });
            } else {
                console.info('Setting duration colors');
                setting.duration = {
                    sum: (item.targets?.find(x => x.measurement == 'Sum')?.target) ? colors[index % colors.length][1] : undefined,
                    avg: (item.targets?.find(x => x.measurement == 'Avg')?.target) ? colors[index % colors.length][2] : undefined,
                    min: (item.targets?.find(x => x.measurement == 'Min')?.target) ? colors[index % colors.length][3] : undefined,
                    max: (item.targets?.find(x => x.measurement == 'Max')?.target) ? colors[index % colors.length][4] : undefined,
                };
            }
        } else if (isNew) {
            console.info('Setting default duration color (avg)');
            setting.duration = {
                avg: colors[index % colors.length][1]
            }
        }
    } else if (setting.duration) {
        delete setting.duration;
    }
}

function setFrequencyColorIfBoolean(setting: BehaviorSettings, color: string) {
    if(setting.frequency == undefined) {
        return;
    }
    if(typeof setting.frequency == 'boolean') {
        if(setting.frequency) {
            setting.frequency = color;
        } else {
            delete setting.frequency;
        }
    }
}

function updateDashboardSettings(settings: StudentDashboardSettings | undefined, student: StudentConfigStorage) {
    if(!settings) {
        return;
    }
    console.info("Constructing device settings");
    const deviceSettings: DashboardDeviceSettings[] = [];
    if (!settings!.devices) {
        settings!.devices = deviceSettings;
    } else {
        if(!settings.devices) {
            settings.devices = []
        }
        deviceSettings.forEach(x => {
            if (settings && !settings.devices!.find(y => x?.id === y.id)) {
                settings.devices.push(x);
            }
        });
    }

    console.info("Constructing behavior settings");
    if(!settings!.behaviors) {
        settings!.behaviors = [];
    }
    settings!.behaviors = (student.behaviors ?? [])
        .filter(b => !b.isArchived)
        .map((b, i) => {
            const existing = settings!.behaviors!.find(x => x.id === b.id);
            if (existing) {
                setFrequencyColorIfBoolean(existing, colors[i % colors.length][0]);
                evalDurationColorMapping(b, existing, i);
                return existing;
            }
            const fcolor = colors[i % colors.length][0];

            const retval = {
                id: b.id,
                frequency: fcolor,
            } as BehaviorSettings;
            evalDurationColorMapping(b, retval, i, true);
            return retval;
        });

    console.info("Constructing response settings");
    if (!settings!.responses) {
        settings!.responses = [];
    }
    settings!.responses = (student.responses ?? []).map((b, i) => {
        const existing = settings!.responses!.find(x => x.id === b.id);
        if (existing) {
            setFrequencyColorIfBoolean(existing, colors[(settings!.behaviors.length + i) % colors.length][0]);
            evalDurationColorMapping(b, existing, settings!.behaviors.length + i);
            return existing;
        }

        const retval = {
            id: b.id,
            frequency: colors[(settings!.behaviors.length + i) % colors.length][0]
        } as BehaviorSettings;
        evalDurationColorMapping(b, retval, settings!.behaviors.length + i, true);
        return retval;
    }) ?? [];

    console.info("Constructing autoExcludeDays");
    if (!settings!.autoExcludeDays) {
        settings!.autoExcludeDays = [0, 6];
    }

    return settings;
}

function getDashboardSettings(student: StudentConfigStorage): StudentDashboardSettings {
    let settings = student.dashboard;

    if (!settings) {
        settings = {
            behaviors: [],
            responses: [],
            antecedents: [],
            devices: [],
            velocity: {
                enabled: false
            },
            summary: {
                after45: 'Weeks' as any,
                after150: 'Months' as any,
                calculationType: 'avg' as any,
                showTargets: true,
                averageDays: 5
            },
            autoExcludeDays: [0, 6]
        };
    }
    if (!settings!.summary) {
        settings!.summary = {
            after45: 'Weeks' as any,
            after150: 'Months' as any,
            calculationType: 'avg' as any,
            showTargets: true,
            averageDays: 5
        };
    }
   
    return updateDashboardSettings(settings!, student)!;
}
