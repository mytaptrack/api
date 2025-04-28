'use strict';
import { v4 as uuid } from 'uuid';
import { v2, WebUtils, WebUserDetails, moment, LicenseDal } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';
import { userInfo } from 'os';

export const handleEvent = WebUtils.apiWrapperEx(createStudent, {
    schema: typesV2.StudentCreateRequestSchema
});

export async function createStudent(request: typesV2.StudentCreateRequest, webUser: WebUserDetails) {
    if (request.studentId) {
        const student = await v2.StudentDal.getStudent(request.studentId, webUser.userId);
        if(!student || (!webUser.licenses!.find(x => x == student.license) && (student.restrictions.data != typesV2.AccessLevel.admin && student.restrictions.schedules !== typesV2.AccessLevel.admin))) {
            return;
        }

        if(webUser.licenses!.find(x => x == student.license) || student.restrictions.data === typesV2.AccessLevel.admin) {
            student.details.firstName = request.firstName;
            student.details.lastName = request.lastName;
            student.details.nickname = request.subtext;
            student.archived = request.archived;

            if(JSON.stringify(student.tags) != JSON.stringify(request.tags) && student.license) {
                student.tags = request.tags;
                const license = await v2.LicenseDal.get(student.license);
                v2.StudentDal.evaluateAbcCollections(student, license);
            } else {
                student.tags = request.tags;
            }
        }
        if(webUser.licenses!.find(x => x == student.license) || student.restrictions.milestones === typesV2.AccessLevel.admin) {
            student.milestones = request.milestones? request.milestones : student.milestones;
        }

        let license: typesV2.LicenseDetails;
        if(student.license) {
            license = await v2.LicenseDal.get(student.license);
            WebUtils.logObjectDetails(student);
            WebUtils.logObjectDetails(license);
            await v2.processStudentTemplates(student, student.license, { student: license.studentTemplates ?? [] });
        }

        await v2.StudentDal.saveStudent(student);

        if(!student.licenseDetails.features && license) {
            student.licenseDetails.features = license.features;
        }
        return student;
    }

    console.log('Creating new student id');
    request.studentId = uuid();
    const license = webUser.licenses[0];
    console.log('License');

    const licenseDetails = await LicenseDal.get(license);

    console.log('Constructing student');
    let student = {
        studentId: request.studentId,
        details: {
            firstName: request.firstName,
            lastName: request.lastName,
            nickname: request.subtext ?? `${request.firstName} ${request.lastName}`
        },
        license,
        licenseDetails: {
            fullYear: false,
            flexible: false,
            expiration: licenseDetails.expiration,
            features: licenseDetails.features
        },
        behaviors: [],
        devices: [],
        documents: [],
        responses: [],
        milestones: [],
        absences: [],
        services: [],
        lastTracked: moment().toISOString(),
        lastUpdateDate: moment().toISOString(),
        restrictions: {} as any,
        tags: request.tags,
        version: 2
    } as typesV2.Student;

    console.log('Adding student to database');
    await v2.StudentDal.saveStudent(student);

    console.log('Adding user to team');
    console.debug('webUser', webUser);
    await v2.TeamDal.putTeamMember({
        userId: webUser.userId,
        studentId: student.studentId,
        details: {
            email: webUser.email,
            name: webUser.name
        },
        license,
        status: typesV2.UserSummaryStatus.Verified,
        restrictions: {
            info: typesV2.AccessLevel.admin,
            service: typesV2.AccessLevel.admin,
            data: typesV2.AccessLevel.admin,
            schedules: typesV2.AccessLevel.admin,
            devices: typesV2.AccessLevel.admin,
            team: typesV2.AccessLevel.admin,
            comments: typesV2.AccessLevel.admin,
            behavior: typesV2.AccessLevel.admin,
            abc: typesV2.AccessLevel.admin,
            milestones: typesV2.AccessLevel.admin,
            reports: typesV2.AccessLevel.admin,
            notifications: typesV2.AccessLevel.admin,
            documents: typesV2.AccessLevel.admin,
            serviceData: typesV2.AccessLevel.admin,
            serviceGoals: typesV2.AccessLevel.admin,
            serviceSchedule: typesV2.AccessLevel.admin,
        },
        version: 1
    });

    if(student.license) {
        const license = await v2.LicenseDal.get(student.license);
        await v2.processStudentTemplates(student, student.license, { student: license.studentTemplates! });
    }

    return student;
};
