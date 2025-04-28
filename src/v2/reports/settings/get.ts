import { 
    LambdaAppsyncQueryClient, TeamDal, WebError, WebUserDetails, WebUtils
} from '@mytaptrack/lib';
import { AccessLevel, QLStudent, StudentDashboardSettings } from '@mytaptrack/types';
import { Schema } from 'jsonschema';

const appsync = new LambdaAppsyncQueryClient(process.env.appsyncUrl);

const ParameterSchema: Schema = {
    type: 'object',
    properties: {
        studentId: { type: 'string', required: true }
    }
};

export const handleEvent = WebUtils.apiWrapperEx(handler, { processBody: 'Parameters', schema: ParameterSchema });

export async function handler (data: { studentId: string }, userDetails: WebUserDetails): Promise<StudentDashboardSettings> {
    console.log('Getting student id');
    const studentId = data.studentId;

    console.log('Checking if user is on students team');
    const teamMember = await TeamDal.getTeamMember(userDetails.userId, studentId)
    if(teamMember.restrictions.data == AccessLevel.none) {
        throw new WebError('Access Denied');
    }

    const student = await appsync.query<QLStudent>(`
        query getStudent($studentId: String!) {
            getStudent(studentId: $studentId) {
                dashboard {
                    antecedents {
                        display
                        name
                    }
                    autoExcludeDays
                    chartType
                    behaviors {
                        duration {
                            avg
                            max
                            min
                            sum
                            target
                        }
                        frequency
                        id
                    }
                    devices {
                        calculation
                        id
                        name
                    }
                    measurementUnit
                    responses {
                        frequency
                        duration {
                            avg
                            max
                            min
                            sum
                        }
                        id
                    }
                    showExcludedChartGaps
                    summary {
                        after150
                        after45
                        averageDays
                        calculationType
                        showTargets
                    }
                    velocity {
                        enabled
                        trackedEvent
                    }
                }
            }
        }`, { studentId }, 'getStudent');

    if(student.dashboard.velocity?.trackedEvent == null) {
        delete student.dashboard.velocity?.trackedEvent;
    }
    return student.dashboard;
    // return null;
};