import { LambdaAppsyncQueryClient, StudentDal, TeamDal, WebUserDetails, WebUtils, moment } from "@mytaptrack/lib";
import { generateToken, getTokenKey } from "./token-utils";
import { AccessLevel, QLAppToken } from "@mytaptrack/types";
import { Schema } from "jsonschema";
import { toDataURL } from "qrcode";

const appsync = new LambdaAppsyncQueryClient(process.env.appsyncUrl);

const ParameterSchema: Schema = {
    type: 'object',
    properties: {
        studentId: { type: 'string' },
        appId: { type: 'string' }
    },
    required: ['studentId', 'appId']
};

export const handleEvent = WebUtils.apiWrapperEx(handler, { processBody: 'Parameters', schema: ParameterSchema });

export async function handler(data: { studentId: string, appId: string }, userDetails: WebUserDetails): Promise<{ appId: string, token: string }> {
    console.log('Getting student id');
    const studentId = data.studentId;
    let license: string;
    try {
        const teamMember = await TeamDal.getTeamMember(userDetails.userId, studentId, false);
        if(teamMember.restrictions.devices != AccessLevel.admin) {
            throw new Error('Access Denied');
        }
        license = teamMember.license;
    } catch(err) {
        if(err.message !== 'Access Denied') {
            throw err;
        }
        console.info('Evaluating license admin permissions');
        const student = await StudentDal.getStudentConfig(studentId);
        const isLicenseAdmin = student?.license && userDetails.licenses.includes(student.license);

        if(!isLicenseAdmin) {
            throw new Error('Access Denied');
        }
        license = student.license;
    }
    
    const app = await appsync.query<QLAppToken>(`
        query getAppToken($license: String!, $deviceId: String!, $expiration: Long) {
            getAppToken(license:$license, deviceId: $deviceId, expiration: $expiration) {
                token
            }
        }
        `,
        {
            license,
            deviceId: data.appId,
            expiration: moment().add(2, 'days').toDate().getTime()
        }, 'getAppToken');
    WebUtils.logObjectDetails(app);

    return {
        appId: data.appId,
        token: app.token
    };
};
