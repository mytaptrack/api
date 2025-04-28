'use strict';
import { v4 as uuid } from 'uuid';
import { WebUtils, WebError, WebUserDetails, moment, StudentDal, LicenseDal, TeamDal, UserDal } from '@mytaptrack/lib';
import { AccessLevel, Student, StudentBulkPut, StudentBulkPutSchema, User, UserSummaryStatus } from '@mytaptrack/types';

export const handleEvent = WebUtils.apiWrapperEx(handler, {
    schema: StudentBulkPutSchema
});

export async function handler(request: StudentBulkPut, webUser: WebUserDetails) {
    if(!webUser.licenses || !webUser.licenses.find(x => x == request.license)) {
        throw new WebError('You do not have access to this license');
    }
    const [students, license] = await Promise.all([
        StudentDal.getStudentsByLicense(request.license),
        LicenseDal.get(request.license)
    ]);
    const userMap: {[key: string]: Promise<User>} = {};
    await Promise.all(request.students.map(async student => {
        if(!student.licenseType) {
            return;
        }
        const existingStudent = students.find(x => x.details.firstName == student.firstName && x.details.lastName == student.lastName);
        if(existingStudent) {
            console.log('Updating student');
            const details = existingStudent.licenseDetails;
            const licenseType = details!.flexible? 'Flexible' : details!.fullYear? 'Single' : 'None';
            if(licenseType != student.licenseType) {
                details!.flexible = student.licenseType.toLowerCase() == 'flexible';
                details!.fullYear = student.licenseType.toLowerCase() == 'single';
                console.log('Setting license', details!.flexible, details!.fullYear);

                if(details!.fullYear && license.singleCount <= students.filter(x => x.licenseDetails!.fullYear).length) {
                    throw new WebError('License limit reached');
                }
                await StudentDal.updateLicense(existingStudent.studentId, request.license, details!, false, existingStudent.tags);
            }
            await addUserInvites(request.license, existingStudent.studentId, student, userMap, webUser);

            return;
        }

        console.log('Creating student');
        const newStudent: Student = {
            studentId: uuid(),
            details: {
                firstName: student.firstName,
                lastName: student.lastName
            },
            license: request.license,
            licenseDetails: {
                flexible: student.licenseType.toLowerCase() == 'flexible',
                fullYear: student.licenseType.toLowerCase() == 'single',
                features: license.features!,
                expiration: license.expiration
            },
            documents: [],
            tags: student.tags,
            milestones: [],
            absences: [],
            restrictions: {} as any,
            behaviors: [],
            responses: [],
            scheduleCategories: [],
            services: [],
            lastTracked: moment().toISOString(),
            lastUpdateDate: moment().toISOString(),
            version: 1
        };

        students.push(newStudent);
        if(newStudent.licenseDetails!.fullYear && license.singleCount <= students.filter(x => x.licenseDetails!.fullYear).length) {
            throw new WebError('License limit reached');
        }
        await Promise.all([
            StudentDal.saveStudent(newStudent),
            TeamDal.putTeamMember({
                studentId: newStudent.studentId,
                userId: webUser.userId,
                license: request.license,
                restrictions: {
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
                    serviceSchedule: AccessLevel.admin
                },
                status: UserSummaryStatus.Verified,
                details: {
                    email: webUser.email,
                    name: webUser.name
                },
                version: 1
            })
        ]);
        await StudentDal.updateLicense(newStudent.studentId, request.license, newStudent.licenseDetails!, false, newStudent.tags);
        await addUserInvites(request.license, newStudent.studentId, student, userMap, webUser);
    }));
};

async function addUserInvites(license: string, studentId: string, student: { firstName: string; lastName: string; invites: string[]; }, userMap: { [key: string]: Promise<User>; }, webUser: WebUserDetails) {
    console.log('Getting team for student', studentId);
    const team = (await TeamDal.getTeam(studentId)) ?? [];

    await Promise.all(student.invites.map(async invite => {
        if(team.find(x => x.details.email == invite)) {
            console.log('User already on team', invite);
            return;
        }
        if(!userMap[invite]) {
            console.log('Getting user', invite);
            userMap[invite] = UserDal.getUserByEmail(invite);
        }
        const user = await userMap[invite];

        if(user) {
            console.log('User exists, adding to team', invite);
            await TeamDal.putTeamMember({
                studentId: studentId,
                userId: user.userId,
                license,
                restrictions: {
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
                },
                status: UserSummaryStatus.PendingApproval,
                details: {
                    email: webUser.email,
                    name: webUser.name
                },
                version: 1
            });    
        } else {
            console.log('Adding user invite', invite);
            await UserDal.saveUserInvite(
                invite,
                studentId,
                {
                    date: new Date().getTime(),
                    restrictions: {
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
                    },
                    status: UserSummaryStatus.PendingApproval,
                    requester: webUser.userId
                }
            );
        }
    }));
}