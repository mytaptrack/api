import { S3 } from '@aws-sdk/client-s3';
import { v2, WebUtils, WebError, WebUserDetails, moment, StudentDal, DataDal, LambdaAppsyncQueryClient } from '@mytaptrack/lib';
import { AccessLevel, QLSnapshotReport, StudentReportPostRequest, StudentReportPostRequestSchema, StudentSummaryReport, StudentSummaryReportBehavior } from '@mytaptrack/types';

const appsync = new LambdaAppsyncQueryClient(process.env.appsyncUrl);

const s3 = new S3();

export const handleEvent = WebUtils.apiWrapperEx(reportPost, {
    schema: StudentReportPostRequestSchema
});

export async function reportPost (request: StudentReportPostRequest, userDetails: WebUserDetails): Promise<StudentSummaryReport> {
    const team = await v2.TeamDal.getTeamMember(userDetails.userId, request.studentId);
    if(team.restrictions.reports == AccessLevel.none) {
        throw new WebError('Access Denied');
    }

    const report = await appsync.query<QLSnapshotReport>(`
        query getSnapshot($studentId: String!, $date: String!, $userId: String, $timezone: String) {
            getSnapshot(studentId: $studentId, date: $date, reportType: "Weekly", userId: $userId, timezone: $timezone) {
                behaviors {
                    behaviorId
                    displayText
                    faces {
                        face
                        overwrite
                    }
                    isDuration
                    show
                    stats {
                        day {
                            count
                            delta
                            modifier
                        }
                        week {
                            count
                            delta
                            modifier
                        }
                    }
                    targets {
                        avg {
                            measurement
                            measurements {
                                name
                                value
                            }
                            progress
                            target
                        }
                        frequency {
                            measurements {
                                name
                                value
                            }
                            measurement
                            progress
                            target
                        }
                        max {
                            measurement
                            measurements {
                                name
                                value
                            }
                            progress
                            target
                        }
                        min {
                            measurement
                            measurements {
                                name
                                value
                            }
                            progress
                            target
                        }
                        sum {
                            measurement
                            measurements {
                                name
                                value
                            }
                            progress
                            target
                        }
                    }
                }
                date
                lastModified {
                    date
                    userId
                }
                legend {
                    behavior
                    measurement
                    measurements {
                        color
                        order
                        name
                        value
                    }
                    progress
                    target
                }
                message
                published
                studentId
                type
            }
        }
        `, { date: request.date, studentId: request.studentId, userId: userDetails.userId, timezone: request.timezone }, 'getSnapshot');

    return {
        behaviors: report.behaviors,
        legend: report.legend,
        date: report.date,
        studentId: report.studentId,
        lastModified: report.lastModified,
        message: report.message? JSON.parse(report.message) as any : {},
        type: report.type as any,
        version: 1
    };
}
