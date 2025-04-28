import { LicenseDal, v2, WebError, WebUserDetails, WebUtils} from '@mytaptrack/lib';
import { AccessLevel, BehaviorCalculation, BehaviorSettings, CalculationType, SummaryScope, UserSummary } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(studentGet, { processBody: 'Parameters' });
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
    ['#BDB411', '#D9CD30', '#F0E35B', '#EDE27E', '#FFF5AB']
];
export const colors_light = ['#C2C2FF', '#FFC2C2', '#C2FFC2', '#777', '#33ffff', '#ff66ff', '#ffb266', '#9933ff'];

export async function studentGet (data: any, userDetails: WebUserDetails) {
    console.log('Getting student id');
    const studentId = data.studentId;

    if(data.studentId == 'null') {
        return;
    }

    console.log('Checking if user is on students team');
    let hasAccess: UserSummary | undefined;
    try {
        hasAccess = await v2.TeamDal.getTeamMember(userDetails.userId, studentId);
    } catch (e) {
        if(e.message !== 'Access Denied') {
            throw e;
        }
    }
    WebUtils.logObjectDetails(userDetails.licenses);
    let admin = false;
    if(!hasAccess && (userDetails.licenses?.length ?? 0) > 0) {
        console.log('Checking license global access');
        const conf = await v2.StudentDal.getStudentConfig(studentId);

        console.log('Verifying license in user list of licenses');
        if(conf && userDetails.licenses!.find(l => l == conf.license)) {
            admin = true;
            console.log('Giving admin read access');
            hasAccess = {
                restrictions: {
                    behavior: AccessLevel.admin
                }
            } as any;
        }
    }
    if(!hasAccess) {
        throw new WebError('Access Denied');
    }
    
    console.log('User is on student team');
    let student = await v2.StudentDal.getStudent(studentId, userDetails.userId);
    if(!student.restrictions && admin) {
        student.restrictions = hasAccess.restrictions;
    }
    if(student.restrictions?.behaviors && student.restrictions.behavior != AccessLevel.none) {
        student.behaviors = student.behaviors.filter(x => student.restrictions.behaviors!.find(y => y == x.id))
    } else if(student.restrictions.behavior == AccessLevel.none) {
        student.behaviors = [];
    }

    if(!student.dashboard) {
        student.dashboard = {
            antecedents: [],
            behaviors: student.behaviors.filter(x => !x.isArchived).map((x, i) => ({
                id: x.id!,
                frequency: colors[i % colors.length][0],
                duration: {
                    sum: colors[i % colors.length][1]
                }
            } as BehaviorSettings)),
            responses: [],
            devices: [],
            velocity: {
                enabled: false,
            },
            summary: {
                after45: SummaryScope.auto,
                after150: SummaryScope.auto,
                calculationType: CalculationType.sum,
                showTargets: true,
                averageDays: 7
            },
            autoExcludeDays: [0, 6]
        };
    }
    if(student.license && !student.licenseDetails.features) {
        const license = await LicenseDal.get(student.license);
        student.licenseDetails.features = license.features;
    }
    WebUtils.logObjectDetails(student);

    return student;
};
